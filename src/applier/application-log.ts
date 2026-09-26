import { appendFileSync } from "node:fs";
import { join } from "node:path";

export interface LoggedApplicationField {
  label: string;
  value: string;
  required?: boolean;
  category?: string;
}

export interface SuccessfulApplicationLogEntry {
  company: string;
  title: string;
  url: string;
  appliedAt: Date;
  platform?: string;
  fields: LoggedApplicationField[];
}

function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatApplicationLogEntry(entry: SuccessfulApplicationLogEntry): string {
  const lines = [
    "=".repeat(80),
    `Job: ${oneLine(entry.company)} -- ${oneLine(entry.title)}`,
    `Link: ${oneLine(entry.url)}`,
    `Date applied: ${entry.appliedAt.toISOString()}`,
  ];

  if (entry.platform) lines.push(`Platform: ${oneLine(entry.platform)}`);
  lines.push("Fields:");

  for (const field of entry.fields) {
    const flags = [field.required ? "required" : "optional", field.category]
      .filter(Boolean)
      .join(", ");
    const value = field.value ? oneLine(field.value) : "[blank]";
    lines.push(`- ${oneLine(field.label)}${flags ? ` (${flags})` : ""}: ${value}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function appendApplicationLog(
  entry: SuccessfulApplicationLogEntry,
  logPath = join(process.cwd(), "log.txt"),
): string {
  appendFileSync(logPath, formatApplicationLogEntry(entry), { encoding: "utf8" });
  return logPath;
}
