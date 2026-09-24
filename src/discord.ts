import { formatAge } from "./format.ts";
import { formatRoleType, type RoleType } from "./role.ts";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Discord HTTP ${res.status}: ${text}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sends a real-time notification to Discord when a job is auto-applied.
 */
export async function sendApplicationAlert(
  webhookUrl: string,
  info: {
    company: string;
    title: string;
    url: string;
    platform: string;
    roleType?: RoleType | string;
    appliedAt?: number;
  },
): Promise<{ success: boolean; error?: string }> {
  const nowMs = (info.appliedAt ? info.appliedAt * 1000 : Date.now());
  const dateStr = new Date(nowMs).toLocaleString("en-US", {
    timeZoneName: "short",
  });

  const fields: DiscordEmbedField[] = [
    { name: "Company", value: info.company, inline: true },
    { name: "Platform", value: info.platform.toUpperCase(), inline: true },
  ];

  if (info.roleType) {
    const roleLabel =
      info.roleType === "intern" || info.roleType === "fulltime"
        ? formatRoleType(info.roleType as RoleType)
        : String(info.roleType);
    fields.push({ name: "Role Type", value: roleLabel, inline: true });
  }

  fields.push(
    { name: "Applied At", value: dateStr, inline: true },
    { name: "Job Link", value: `[View Application](${info.url})`, inline: false },
  );

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: `✅ Auto-Applied: ${info.title}`,
        url: info.url,
        color: 0x2ecc71, // Green
        fields,
        footer: { text: "safar auto-applier" },
        timestamp: new Date(nowMs).toISOString(),
      },
    ],
  };

  return sendDiscordWebhook(webhookUrl, payload);
}

/**
 * Sends an end-of-day summary report to Discord listing all jobs applied today.
 */
export async function sendEndOfDayReport(
  webhookUrl: string,
  info: {
    date: string; // e.g. "2026-09-22"
    applications: {
      company: string;
      title: string;
      url: string;
      platform: string;
      roleType?: RoleType | string;
      appliedAt: number;
    }[];
  },
): Promise<{ success: boolean; error?: string }> {
  const totalCount = info.applications.length;

  let description: string;
  if (totalCount === 0) {
    description = `No job applications were submitted on **${info.date}**.`;
  } else {
    description = `**${totalCount} application${totalCount === 1 ? "" : "s"}** submitted on **${info.date}**:\n\n`;
    const lines = info.applications.map((app, index) => {
      const timeStr = new Date(app.appliedAt * 1000).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const roleBadgeStr = app.roleType ? `\`[${app.roleType === "intern" ? "Intern" : "FT"}]\` ` : "";
      return `${index + 1}. **${app.company}** — [${app.title}](${app.url}) ${roleBadgeStr}(${app.platform.toUpperCase()}) at \`${timeStr}\``;
    });

    // Discord descriptions have a 4096 character limit
    const joined = lines.join("\n");
    if (joined.length > 3900) {
      description += joined.slice(0, 3850) + "\n...and more.";
    } else {
      description += joined;
    }
  }

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: `📊 Daily Application Summary — ${info.date}`,
        description,
        color: totalCount > 0 ? 0x3498db : 0x95a5a6, // Blue or Gray
        fields: [
          {
            name: "Total Applied Today",
            value: `**${totalCount}**`,
            inline: true,
          },
        ],
        footer: { text: "safar end-of-day check" },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  return sendDiscordWebhook(webhookUrl, payload);
}
