import { spawnSync } from "node:child_process";
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
import { loadConfig, type ProfileConfig } from "../config.ts";
import { sendApplicationAlert } from "../discord.ts";

export interface AutoApplyOptions {
  lookbackDays?: number; // default: 3
  dryRun?: boolean; // default: false
  limit?: number; // max applications in this run (optional)
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
    status: "applied" | "skipped" | "already_applied";
    reason?: string;
  }[];
}

/**
 * Runs the headless Playwright runner script via Node child_process.
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

    // 1. Check if already applied or reposted
    const dedup = isJobAlreadyApplied(db, job);
    if (dedup.applied) {
      summary.alreadyAppliedCount++;
      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
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
        status: "skipped",
        reason,
      });
      continue;
    }

    // 3. Classify job questions
    options.onProgress?.(`Classifying ${job.company} — "${job.title}" (${platform})...`);
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
        status: "skipped",
        reason,
      });
      continue;
    }

    // 4. Job is a default job! Check profile configuration
    if (!config.profile) {
      const reason = "Profile details missing in ~/.config/safar/config.json";
      recordSkippedJob(db, job.id, reason, now);
      summary.skippedCount++;
      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
        status: "skipped",
        reason,
      });
      continue;
    }

    // 5. Submit application headlessly via Playwright
    options.onProgress?.(`Auto-applying to ${job.company} — "${job.title}" (${dryRun ? "DRY-RUN" : "LIVE"})...`);
    const applyRes = invokePlaywrightRunner({
      url: job.url,
      platform,
      profile: config.profile,
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
            appliedAt: now,
          });
        }
      }

      summary.results.push({
        jobId: job.id,
        company: job.company,
        title: job.title,
        url: job.url,
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
