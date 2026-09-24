import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import {
  type JobRecord,
  setStatus,
  recordSkippedJob,
  type ApplicationStatus,
} from "../db/repo.ts";
import { isJobAlreadyApplied } from "../dedup.ts";
import { classifyJob, detectPlatform } from "../classifier.ts";
import { detectJobSite } from "../site.ts";
import { loadConfig, resolveProfileForRole, type ProfileConfig } from "../config.ts";
import { sendApplicationAlert } from "../discord.ts";
import { detectRoleType, formatRoleType, roleBadge, type RoleType } from "../role.ts";

export interface AutoApplyOptions {
  lookbackDays?: number; // default: 3
  dryRun?: boolean; // default: false
  limit?: number; // max applications in this run (optional)
  role?: RoleType | "all"; // filter by role type (intern vs fulltime)
  onProgress?: (message: string) => void;
}

export interface AutoApplyBatchResult {
  totalScanned: number;
  appliedCount: number;
  skippedCount: number;
  alreadyAppliedCount: number;
  results: {
    jobId: number;
    company: string;
    title: string;
    url: string;
    roleType?: RoleType;
    status: "applied" | "skipped" | "already_applied";
    reason?: string;
  }[];
}

export interface AutoApplySingleResult {
  success: boolean;
  platform?: string;
  roleType?: RoleType;
  dryRun?: boolean;
  reason?: string;
}

/**
 * Runs the headless Playwright runner script asynchronously via Node child_process.spawn.
 */
export function invokePlaywrightRunnerAsync(payload: {
  url: string;
  platform: string;
  profile: ProfileConfig;
  dryRun: boolean;
}): Promise<{ success: boolean; dryRun?: boolean; error?: string; message?: string }> {
  return new Promise((resolve) => {
    const runnerPath = join(__dirname, "playwright-runner.cjs");
    const proc = spawn("node", [runnerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });

    proc.on("close", (code) => {
      try {
        const out = JSON.parse(stdout.trim() || stderr.trim());
        resolve(out);
      } catch {
        resolve({
          success: false,
          error: stderr.trim() || stdout.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

/**
 * Evaluates and auto-applies to a single job (used by TUI hotkey and programmatic calls).
 */
export async function autoApplySingleJob(
  db: Database,
  job: JobRecord,
  options: { dryRun?: boolean } = {},
): Promise<AutoApplySingleResult> {
  const config = loadConfig();
  const dryRun = options.dryRun ?? config.autoApply?.dryRun ?? false;
  const now = Math.floor(Date.now() / 1000);
  const roleType = detectRoleType(job);

  // 1. Check if already applied or reposted
  const dedup = isJobAlreadyApplied(db, job);
  if (dedup.applied) {
    return {
      success: false,
      roleType,
      reason: `Already applied (${dedup.reason})`,
    };
  }

  // 2. Check platform
  const platform = detectPlatform(job.url);
  if (platform === "other") {
    const site = detectJobSite(job.url);
    const reason = `Unsupported platform (${site.label}) — only Greenhouse and Ashby supported`;
    recordSkippedJob(db, job.id, reason, now);
    return {
      success: false,
      platform,
      roleType,
      reason,
    };
  }

  // 3. Classify job questions
  const classification = await classifyJob(job);
  if (!classification.isDefaultJob) {
    const reason = classification.reason || "Custom questions required";
    recordSkippedJob(db, job.id, reason, now);
    return {
      success: false,
      platform,
      roleType,
      reason,
    };
  }

  // 4. Resolve profile for this role type
  const resolvedProfile = resolveProfileForRole(config.profile, roleType);
  if (
    !resolvedProfile ||
    !resolvedProfile.firstName ||
    !resolvedProfile.lastName ||
    !resolvedProfile.email
  ) {
    const reason = `Profile details missing in config for ${formatRoleType(roleType)}`;
    recordSkippedJob(db, job.id, reason, now);
    return {
      success: false,
      platform,
      roleType,
      reason,
    };
  }

  // 5. Submit application headlessly via Playwright
  const applyRes = await invokePlaywrightRunnerAsync({
    url: job.url,
    platform,
    profile: resolvedProfile,
    dryRun,
  });

  if (applyRes.success) {
    if (!dryRun) {
      setStatus(db, job.id, "applied", now);
      if (config.discord?.webhookUrl) {
        void sendApplicationAlert(config.discord.webhookUrl, {
          company: job.company,
          title: job.title,
          url: job.url,
          platform,
          roleType,
          appliedAt: now,
        });
      }
    }
    return {
      success: true,
      platform,
      roleType,
      dryRun,
    };
  } else {
    const reason = `Auto-apply failed: ${applyRes.error || "Unknown error"}`;
    recordSkippedJob(db, job.id, reason, now);
    return {
      success: false,
      platform,
      roleType,
      reason,
    };
  }
}

/**
 * Runs the headless Playwright runner script via Node child_process (sync).
 */
function invokePlaywrightRunner(payload: {
  url: string;
  platform: string;
  profile: ProfileConfig;
  dryRun: boolean;
}): { success: boolean; dryRun?: boolean; error?: string; message?: string } {
  const runnerPath = join(__dirname, "playwright-runner.cjs");

  const proc = spawnSync("node", [runnerPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 60000,
  });

  if (proc.error) {
    return { success: false, error: proc.error.message };
  }

  try {
    const out = JSON.parse(proc.stdout.trim() || proc.stderr.trim());
    return out;
  } catch {
    return {
      success: false,
      error: proc.stderr || proc.stdout || `Process exited with code ${proc.status}`,
    };
  }
}

/**
 * Orchestrates scanning recent jobs (past 3 days), classifying them, and auto-applying
 * to default Greenhouse and Ashby jobs.
 */
export async function runAutoApplyBatch(
  db: Database,
  options: AutoApplyOptions = {},
): Promise<AutoApplyBatchResult> {
  const config = loadConfig();
  const lookbackDays = options.lookbackDays ?? config.autoApply?.lookbackDays ?? 3;
  const dryRun = options.dryRun ?? config.autoApply?.dryRun ?? false;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - lookbackDays * 86400;

  options.onProgress?.(`Scanning active jobs from the past ${lookbackDays} days...`);

  // Query jobs within past lookbackDays (using date_posted or first_seen_at)
  const candidateJobs = db
    .query(
      `SELECT j.*, a.status as status, a.notes as notes, a.updated_at as updated_at
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       WHERE (j.date_posted >= ? OR (j.date_posted IS NULL AND j.first_seen_at >= ?))
         AND j.active = 1
       ORDER BY j.date_posted DESC NULLS LAST, j.first_seen_at DESC`,
    )
    .all(cutoff, cutoff) as any[];

  const summary: AutoApplyBatchResult = {
    totalScanned: candidateJobs.length,
    appliedCount: 0,
    skippedCount: 0,
    alreadyAppliedCount: 0,
    results: [],
  };

  for (const raw of candidateJobs) {
    const job: JobRecord = {
      id: raw.id,
      sourceId: raw.source_id,
      sourceJobId: raw.source_job_id,
      company: raw.company,
      title: raw.title,
      url: raw.url,
      locations: JSON.parse(raw.locations || "[]"),
      workModel: raw.work_model,
      datePosted: raw.date_posted,
      active: !!raw.active,
      extra: JSON.parse(raw.extra || "{}"),
      firstSeenAt: raw.first_seen_at,
      lastSeenAt: raw.last_seen_at,
      status: raw.status ?? null,
      notes: raw.notes ?? null,
      updatedAt: raw.updated_at ?? null,
    };

    // 0. Detect role type and check role filter if specified
    const roleType = detectRoleType(job);
    if (options.role && options.role !== "all" && roleType !== options.role) {
      continue;
    }

    // 1. Check if already applied or reposted
    const dedup = isJobAlreadyApplied(db, job);
    if (dedup.applied) {
      summary.alreadyAppliedCount++;
      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
        roleType,
        status: "already_applied",
        reason: dedup.reason,
      });
      continue;
    }

    // 2. Check platform
    const platform = detectPlatform(job.url);
    if (platform === "other") {
      const site = detectJobSite(job.url);
      const reason = `Unsupported platform (${site.label}) — not Greenhouse or Ashby`;
      recordSkippedJob(db, job.id, reason, now);
      summary.skippedCount++;
      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
        roleType,
        status: "skipped",
        reason,
      });
      continue;
    }

    // 3. Classify job questions
    options.onProgress?.(`Classifying ${job.company} — "${job.title}" [${roleBadge(roleType).toUpperCase()}] (${platform})...`);
    const classification = await classifyJob(job);

    if (!classification.isDefaultJob) {
      const reason = classification.reason || "Custom questions required";
      recordSkippedJob(db, job.id, reason, now);
      summary.skippedCount++;
      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
        roleType,
        status: "skipped",
        reason,
      });
      continue;
    }

    // 4. Job is a default job! Check profile configuration for this role type
    const resolvedProfile = resolveProfileForRole(config.profile, roleType);
    if (!resolvedProfile || !resolvedProfile.firstName || !resolvedProfile.lastName || !resolvedProfile.email) {
      const reason = `Profile details missing in ~/.config/safar/config.json for ${formatRoleType(roleType)}`;
      recordSkippedJob(db, job.id, reason, now);
      summary.skippedCount++;
      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
        roleType,
        status: "skipped",
        reason,
      });
      continue;
    }

    // 5. Submit application headlessly via Playwright
    options.onProgress?.(
      `Auto-applying to ${job.company} — "${job.title}" [${formatRoleType(roleType)}] (${dryRun ? "DRY-RUN" : "LIVE"})...`,
    );
    const applyRes = await invokePlaywrightRunnerAsync({
      url: job.url,
      platform,
      profile: resolvedProfile,
      dryRun,
    });

    if (applyRes.success) {
      summary.appliedCount++;
      if (!dryRun) {
        setStatus(db, job.id, "applied", now);
        // Send real-time Discord notification
        if (config.discord?.webhookUrl) {
          void sendApplicationAlert(config.discord.webhookUrl, {
            company: job.company,
            title: job.title,
            url: job.url,
            platform,
            roleType,
            appliedAt: now,
          });
        }
      }

      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
        roleType,
        status: "applied",
        reason: dryRun ? "Dry-run succeeded" : "Application submitted",
      });
    } else {
      const reason = `Auto-apply failed: ${applyRes.error || "Unknown error"}`;
      recordSkippedJob(db, job.id, reason, now);
      summary.skippedCount++;
      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
        roleType,
        status: "skipped",
        reason,
      });
    }

    // Check limit
    if (options.limit && summary.appliedCount >= options.limit) {
      break;
    }
  }

  return summary;
}
