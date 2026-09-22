import type { Database } from "bun:sqlite";
import { listTrackedJobs, type JobRecord } from "./db/repo.ts";

/**
 * Normalizes company name for deduplication:
 * - Lowercase
 * - Strips common corporate suffixes (Inc, LLC, Corp, Technologies, Co, Ltd)
 * - Strips punctuation and extra whitespace
 */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc\.?|llc|corp\.?|corporation|technologies|technology|co\.?|ltd\.?)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Normalizes job title for repost detection:
 * - Lowercase
 * - Removes bracketed/parenthetical expressions: (remote), [2026], [REQ-12345]
 * - Removes requisition IDs and year tags
 * - Normalizes spacing and punctuation
 * - Preserves core role and specialization (e.g. "software engineer", "intern", "backend")
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    // remove bracketed / parenthetical notes like (remote), [2026], (req 1234)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    // remove requisition ids like R-12345 or #1234
    .replace(/\b[rR]-\d+\b/g, " ")
    .replace(/#\d+/g, " ")
    // remove years 2024-2030
    .replace(/\b202[4-9]\b/g, " ")
    .replace(/\b203[0-9]\b/g, " ")
    // remove season tokens
    .replace(/\b(summer|fall|spring|winter)\b/gi, " ")
    // remove location / work model tokens often appended to titles
    .replace(/\b(remote|hybrid|onsite|on-site)\b/gi, " ")
    // normalize synonyms
    .replace(/\bco-op\b/gi, "intern")
    .replace(/\bcoop\b/gi, "intern")
    .replace(/\binternship\b/gi, "intern")
    .replace(/\buniversity grad(uate)?\b/gi, "new grad")
    // strip special characters
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DedupCheckResult {
  applied: boolean;
  reason?: string;
  existingJob?: JobRecord;
}

/**
 * Checks whether a job has already been applied to:
 * 1. Direct Job ID in applications table (status != 'saved')
 * 2. Exact URL in applications table (status != 'saved')
 * 3. Repost detection: same normalized company and normalized title in applications table
 */
export function isJobAlreadyApplied(
  db: Database,
  job: { id: number; company: string; title: string; url: string },
): DedupCheckResult {
  // 1. Direct Job ID match
  const app = db
    .query<{ status: string; updated_at: number }, [number]>(
      "SELECT status, updated_at FROM applications WHERE job_id = ? AND status != 'saved'",
    )
    .get(job.id);
  if (app) {
    return {
      applied: true,
      reason: `Already applied to this job ID (status: ${app.status})`,
    };
  }

  // 2. Exact/canonical URL match
  const cleanUrl = job.url.split("?")[0]!.replace(/\/$/, "");
  const urlMatch = db
    .query<
      { id: number; company: string; title: string; status: string },
      [string, string]
    >(
      `SELECT j.id, j.company, j.title, a.status
       FROM jobs j
       JOIN applications a ON a.job_id = j.id
       WHERE (j.url = ? OR j.url LIKE ?) AND a.status != 'saved'
       LIMIT 1`,
    )
    .get(cleanUrl, `${cleanUrl}%`);

  if (urlMatch) {
    return {
      applied: true,
      reason: `Already applied via matching URL (${urlMatch.company} - "${urlMatch.title}", status: ${urlMatch.status})`,
    };
  }

  // 3. Repost match (same company + normalized title)
  const normCompany = normalizeCompany(job.company);
  const normTitle = normalizeTitle(job.title);

  if (normCompany && normTitle) {
    const tracked = listTrackedJobs(db).filter(
      (j) => j.status && j.status !== "saved",
    );
    for (const t of tracked) {
      if (
        normalizeCompany(t.company) === normCompany &&
        normalizeTitle(t.title) === normTitle
      ) {
        return {
          applied: true,
          reason: `Already applied to reposted role: "${t.title}" at ${t.company} (status: ${t.status})`,
          existingJob: t,
        };
      }
    }
  }

  return { applied: false };
}
