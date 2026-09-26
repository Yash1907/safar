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
import { parseFilterQuery, applyFilter } from "../filter.ts";
import { isUsJob } from "../location.ts";
import {
  appendApplicationLog,
  type LoggedApplicationField,
} from "./application-log.ts";

export interface RunnerField extends LoggedApplicationField {
  filled?: boolean;
  valid?: boolean;
  mustFill?: boolean;
  type?: string;
}

interface RunnerResult {
  success: boolean;
  dryRun?: boolean;
  error?: string;
  message?: string;
  confirmationUrl?: string;
  fields?: RunnerField[];
}

export interface AutoApplyOptions {
  lookbackDays?: number; // default: 3
  dryRun?: boolean; // default: false
  headless?: boolean; // default: true (pass false or --headed to watch browser)
  limit?: number; // max applications in this run (optional)
  role?: RoleType | "all"; // filter by role type (intern vs fulltime)
  filter?: string; // search query syntax to filter target jobs (e.g. "title:forward,software,technology")
  usOnly?: boolean; // exclude non-US locations
  excludeNonUS?: boolean; // alias for usOnly
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
  warning?: string;
  logPath?: string;
}

/**
 * Runs the headless Playwright runner script asynchronously via Node child_process.spawn.
 */
export function invokePlaywrightRunnerAsync(payload: {
  url: string;
  platform: string;
  profile: ProfileConfig;
  roleType?: RoleType;
  dryRun: boolean;
  headless?: boolean;
}): Promise<RunnerResult> {
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
 * Persist only after the runner has observed an ATS confirmation. setStatus is
 * transactional, so the application row and status history move together and
 * future runs immediately deduplicate this job.
 */
export function persistSuccessfulApplication(
  db: Database,
  job: Pick<JobRecord, "id" | "company" | "title" | "url">,
  platform: string,
  fields: RunnerField[],
  appliedAt: number,
  logPath?: string,
): { logPath?: string; warning?: string } {
  setStatus(db, job.id, "applied", appliedAt);
  try {
    const writtenLogPath = appendApplicationLog({
      company: job.company,
      title: job.title,
      url: job.url,
      platform,
      appliedAt: new Date(appliedAt * 1000),
      fields: fields.map((field) => ({
        label: field.label,
        value: field.value,
        required: field.mustFill ?? field.required,
        category: field.category,
      })),
    }, logPath);
    return { logPath: writtenLogPath };
  } catch (error) {
    return {
      warning: `Application was submitted and saved to the database, but log.txt could not be updated: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Evaluates and auto-applies to a single job (used by TUI hotkey and programmatic calls).
 */
export async function autoApplySingleJob(
  db: Database,
  job: JobRecord,
  options: {
    dryRun?: boolean;
    headless?: boolean;
    filter?: string;
    checkFilter?: boolean;
    usOnly?: boolean;
    excludeNonUS?: boolean;
  } = {},
): Promise<AutoApplySingleResult> {
  const config = loadConfig();
  const dryRun = options.dryRun ?? config.autoApply?.dryRun ?? false;
  const headless = options.headless ?? config.autoApply?.headless ?? true;
  const usOnly =
    options.usOnly === true ||
    options.excludeNonUS === true ||
    config.autoApply?.usOnly === true ||
    config.autoApply?.excludeNonUS === true;
  const now = Math.floor(Date.now() / 1000);
  const roleType = detectRoleType(job);

  // Check US location if usOnly is enabled
  if (usOnly && !isUsJob(job)) {
    return {
      success: false,
      roleType,
      reason: `Non-US location (${job.locations.join(", ") || "Unknown"})`,
    };
  }

  // Check filter if explicitly provided or checkFilter is requested
  const filterQuery = options.filter ?? (options.checkFilter ? config.autoApply?.filter : undefined);
  if (filterQuery && filterQuery.trim()) {
    const parsed = parseFilterQuery(filterQuery.trim());
    const matches = applyFilter([job], parsed, () => false).length > 0;
    if (!matches) {
      return {
        success: false,
        roleType,
        reason: `Job does not match filter "${filterQuery.trim()}"`,
      };
    }
  }

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

  // 3. Resolve the role-specific profile before classification so preflight
  // can prove that every required question has a configured answer.
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

  // 4. Classify questions and confirm this profile can answer them.
  const classification = await classifyJob(job, resolvedProfile, roleType);
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

  // 5. Submit application via Playwright
  const applyRes = await invokePlaywrightRunnerAsync({
    url: job.url,
    platform,
    profile: resolvedProfile,
    roleType,
    dryRun,
    headless,
  });

  if (applyRes.success) {
    let persisted: { logPath?: string; warning?: string } = {};
    if (!dryRun) {
      persisted = persistSuccessfulApplication(
        db,
        job,
        platform,
        applyRes.fields ?? [],
        Math.floor(Date.now() / 1000),
      );
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
      ...persisted,
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
}): RunnerResult {
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
  const headless = options.headless ?? config.autoApply?.headless ?? true;

  // Resolve filter: CLI options.filter takes precedence, then config.autoApply.filter
  let effectiveFilter: string | undefined = undefined;
  if (options.filter !== undefined) {
    const f = options.filter.trim();
    if (f.toLowerCase() === "all" || f.toLowerCase() === "none" || f === "") {
      effectiveFilter = undefined;
    } else {
      effectiveFilter = f;
    }
  } else if (config.autoApply?.filter) {
    effectiveFilter = config.autoApply.filter.trim();
  }

  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - lookbackDays * 86400;

  const filterDesc = effectiveFilter ? ` matching filter "${effectiveFilter}"` : "";
  options.onProgress?.(`Scanning active jobs from the past ${lookbackDays} days${filterDesc}...`);

  // Query jobs within past lookbackDays (using date_posted or first_seen_at)
  const rawJobs = db
    .query(
      `SELECT j.*, a.status as status, a.notes as notes, a.updated_at as updated_at
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       WHERE (j.date_posted >= ? OR (j.date_posted IS NULL AND j.first_seen_at >= ?))
         AND j.active = 1
       ORDER BY j.date_posted DESC NULLS LAST, j.first_seen_at DESC`,
    )
    .all(cutoff, cutoff) as any[];

  let candidateJobs: JobRecord[] = rawJobs.map((raw) => ({
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
  }));

  if (effectiveFilter) {
    const parsed = parseFilterQuery(effectiveFilter);
    const beforeCount = candidateJobs.length;
    candidateJobs = applyFilter(candidateJobs, parsed, () => false);
    options.onProgress?.(
      `Filtered candidate jobs with "${effectiveFilter}": ${candidateJobs.length} match out of ${beforeCount}`,
    );
  }

  const usOnly =
    options.usOnly === true ||
    options.excludeNonUS === true ||
    config.autoApply?.usOnly === true ||
    config.autoApply?.excludeNonUS === true;

  if (usOnly) {
    const beforeCount = candidateJobs.length;
    candidateJobs = candidateJobs.filter((job) => isUsJob(job));
    options.onProgress?.(
      `Filtered out non-US locations: ${candidateJobs.length} US jobs remaining out of ${beforeCount}`,
    );
  }

  const summary: AutoApplyBatchResult = {
    totalScanned: candidateJobs.length,
    appliedCount: 0,
    skippedCount: 0,
    alreadyAppliedCount: 0,
    results: [],
  };

  for (const job of candidateJobs) {

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

    // 3. Resolve the role-specific profile first so classification can verify
    // that every required question has a configured answer.
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

    // 4. Classify job questions and check profile answerability.
    options.onProgress?.(`Classifying ${job.company} — "${job.title}" [${roleBadge(roleType).toUpperCase()}] (${platform})...`);
    const classification = await classifyJob(job, resolvedProfile, roleType);

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

    // 5. Submit application via Playwright
    options.onProgress?.(
      `Auto-applying to ${job.company} — "${job.title}" [${formatRoleType(roleType)}] (${dryRun ? "DRY-RUN" : "LIVE"}${headless ? "" : " [HEADED]"})...`,
    );
    const applyRes = await invokePlaywrightRunnerAsync({
      url: job.url,
      platform,
      profile: resolvedProfile,
      roleType,
      dryRun,
      headless,
    });

    if (applyRes.success) {
      summary.appliedCount++;
      let persistenceWarning: string | undefined;
      if (!dryRun) {
        const persisted = persistSuccessfulApplication(
          db,
          job,
          platform,
          applyRes.fields ?? [],
          Math.floor(Date.now() / 1000),
        );
        persistenceWarning = persisted.warning;
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
        reason: dryRun
          ? "Dry-run succeeded (all required fields audited)"
          : persistenceWarning || "Application submitted, recorded in the database, and appended to log.txt",
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
