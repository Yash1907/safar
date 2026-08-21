import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { migrate } from "./schema.ts";
import type { RawJob } from "../sources/types.ts";

export type ApplicationStatus =
  | "saved"
  | "applied"
  | "oa"
  | "interviewing"
  | "offer"
  | "rejected"
  | "withdrawn";

/** Lifecycle order — also the `1`-`7` key mapping in Detail (§3). */
export const STATUS_ORDER: ApplicationStatus[] = [
  "saved",
  "applied",
  "oa",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

export interface JobRecord {
  id: number;
  sourceId: string;
  sourceJobId: string;
  company: string;
  title: string;
  url: string;
  locations: string[];
  workModel: "remote" | "hybrid" | "onsite" | null;
  datePosted: number | null;
  active: boolean;
  extra: Record<string, unknown>;
  firstSeenAt: number;
  lastSeenAt: number;
  status: ApplicationStatus | null;
  notes: string | null;
  updatedAt: number | null; // applications.updated_at — drives Tracker's "days since last update"
}

/** active:false → inactive only, active:any → both, default (undefined) → active only. */
export interface JobFilter {
  active?: "any" | "false";
  sourceId?: string;
  category?: string;
  workModel?: "remote" | "hybrid" | "onsite";
  status?: ApplicationStatus;
  text?: string; // fuzzy match across company + title + location
  newSince?: number; // first_seen_at > newSince
}

/** Resolves the DB path per §2: ~/.local/share/safar/safar.db, overridable via SAFAR_DB. */
export function resolveDbPath(): string {
  if (process.env.SAFAR_DB) return process.env.SAFAR_DB;
  const dir = join(homedir(), ".local", "share", "safar");
  mkdirSync(dir, { recursive: true });
  return join(dir, "safar.db");
}

export function openDb(path: string = resolveDbPath()): Database {
  const db = new Database(path, { create: true });
  migrate(db);
  return db;
}

function rowToJob(row: any): JobRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceJobId: row.source_job_id,
    company: row.company,
    title: row.title,
    url: row.url,
    locations: JSON.parse(row.locations),
    workModel: row.work_model,
    datePosted: row.date_posted,
    active: !!row.active,
    extra: JSON.parse(row.extra),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status ?? null,
    notes: row.notes ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * Upserts a single RawJob. Returns whether this was a brand-new row (insert)
 * vs. an update to an existing one — sync.ts uses this to build +N new/M
 * updated summaries.
 */
export function upsertJob(
  db: Database,
  job: RawJob,
  now: number,
): { isNew: boolean } {
  const existing = db
    .query<{ id: number }, [string, string]>(
      "SELECT id FROM jobs WHERE source_id = ? AND source_job_id = ?",
    )
    .get(job.sourceId, job.sourceJobId);

  const locations = JSON.stringify(job.locations);
  const extra = JSON.stringify(job.extra ?? {});
  const active = job.active === false ? 0 : 1;
  const datePosted = job.datePosted
    ? Math.floor(job.datePosted.getTime() / 1000)
    : null;

  if (existing) {
    db.query(
      `UPDATE jobs SET
         company = ?, title = ?, url = ?, locations = ?, work_model = ?,
         date_posted = ?, active = ?, extra = ?, last_seen_at = ?
       WHERE id = ?`,
    ).run(
      job.company,
      job.title,
      job.url,
      locations,
      job.workModel ?? null,
      datePosted,
      active,
      extra,
      now,
      existing.id,
    );
    return { isNew: false };
  }

  db.query(
    `INSERT INTO jobs
       (source_id, source_job_id, company, title, url, locations, work_model,
        date_posted, active, extra, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.sourceId,
    job.sourceJobId,
    job.company,
    job.title,
    job.url,
    locations,
    job.workModel ?? null,
    datePosted,
    active,
    extra,
    now,
    now,
  );
  return { isNew: true };
}

export function setStatus(
  db: Database,
  jobId: number,
  status: ApplicationStatus,
  now: number,
): void {
  db.transaction(() => {
    db.query(
      `INSERT INTO applications (job_id, status, notes, updated_at)
       VALUES (?, ?, '', ?)
       ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    ).run(jobId, status, now);
    db.query(
      "INSERT INTO status_history (job_id, status, at) VALUES (?, ?, ?)",
    ).run(jobId, status, now);
  })();
}

/**
 * Reverts the most recent status change: deletes its status_history entry
 * and restores applications.status/updated_at to the transition before it
 * — as if the accidental keypress never happened, rather than logging a new
 * forward transition. Returns the restored status, or null if there's
 * nothing to undo (no history, or only the very first status ever set —
 * undoing that would mean untracking the job entirely, which `u` doesn't do).
 */
export function undoLastStatus(db: Database, jobId: number): ApplicationStatus | null {
  const history = db
    .query<{ id: number; status: ApplicationStatus; at: number }, [number]>(
      "SELECT id, status, at FROM status_history WHERE job_id = ? ORDER BY at DESC, id DESC",
    )
    .all(jobId);

  if (history.length < 2) return null;
  const [current, previous] = history as [
    { id: number; status: ApplicationStatus; at: number },
    { id: number; status: ApplicationStatus; at: number },
  ];

  db.transaction(() => {
    db.query("DELETE FROM status_history WHERE id = ?").run(current.id);
    db.query(
      "UPDATE applications SET status = ?, updated_at = ? WHERE job_id = ?",
    ).run(previous.status, previous.at, jobId);
  })();

  return previous.status;
}

/**
 * Adding notes to a job that isn't tracked yet implicitly starts tracking
 * it as "saved" — but that's a real status transition and must be logged
 * to status_history like any other (setStatus does), or the audit trail
 * (and undoLastStatus) silently loses a step.
 */
export function setNotes(db: Database, jobId: number, notes: string, now: number): void {
  db.transaction(() => {
    const existing = db
      .query<{ job_id: number }, [number]>("SELECT job_id FROM applications WHERE job_id = ?")
      .get(jobId);

    if (existing) {
      db.query("UPDATE applications SET notes = ?, updated_at = ? WHERE job_id = ?").run(
        notes,
        now,
        jobId,
      );
    } else {
      db.query(
        "INSERT INTO applications (job_id, status, notes, updated_at) VALUES (?, 'saved', ?, ?)",
      ).run(jobId, notes, now);
      db.query("INSERT INTO status_history (job_id, status, at) VALUES (?, 'saved', ?)").run(
        jobId,
        now,
      );
    }
  })();
}

/**
 * Completely removes tracking for a job: deletes its applications row and
 * all status_history entries, restoring it to untracked (status = null, notes = null)
 * — as if the user never applied or saved it (§ "delete jobs from the browse view so that it's like i never applied").
 * Returns true if an application or history was deleted, false if the job was not tracked.
 */
export function deleteApplication(db: Database, jobId: number): boolean {
  return db.transaction(() => {
    const res1 = db.query("DELETE FROM applications WHERE job_id = ?").run(jobId);
    const res2 = db.query("DELETE FROM status_history WHERE job_id = ?").run(jobId);
    return res1.changes > 0 || res2.changes > 0;
  })();
}

export const untrackJob = deleteApplication;

export function listJobs(db: Database, filter: JobFilter = {}): JobRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.active === "false") {
    clauses.push("j.active = 0");
  } else if (filter.active !== "any") {
    clauses.push("j.active = 1");
  }

  if (filter.sourceId) {
    clauses.push("j.source_id = ?");
    params.push(filter.sourceId);
  }

  if (filter.category) {
    clauses.push("LOWER(json_extract(j.extra, '$.category')) = LOWER(?)");
    params.push(filter.category);
  }

  if (filter.workModel) {
    clauses.push("j.work_model = ?");
    params.push(filter.workModel);
  }

  if (filter.status) {
    clauses.push("a.status = ?");
    params.push(filter.status);
  }

  if (filter.newSince !== undefined) {
    clauses.push("j.first_seen_at > ?");
    params.push(filter.newSince);
  }

  if (filter.text) {
    clauses.push(
      "(LOWER(j.company) LIKE ? OR LOWER(j.title) LIKE ? OR LOWER(j.locations) LIKE ?)",
    );
    const like = `%${filter.text.toLowerCase()}%`;
    params.push(like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .query(
      `SELECT j.*, a.status as status, a.notes as notes, a.updated_at as updated_at
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       ${where}
       ORDER BY j.date_posted DESC NULLS LAST, j.first_seen_at DESC`,
    )
    .all(...(params as any[]));

  return rows.map(rowToJob);
}

export function getJob(db: Database, id: number): JobRecord | null {
  const row = db
    .query(
      `SELECT j.*, a.status as status, a.notes as notes, a.updated_at as updated_at
       FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
       WHERE j.id = ?`,
    )
    .get(id);
  return row ? rowToJob(row) : null;
}

/**
 * §3 View 3 — Tracker: every job with an application row (any status),
 * ignoring the `active` filter entirely (a tracked job stays visible even
 * after its listing goes inactive upstream). Sorted oldest-updated-first
 * within each status so stale applications surface first.
 */
export function listTrackedJobs(db: Database): JobRecord[] {
  const rows = db
    .query(
      `SELECT j.*, a.status as status, a.notes as notes, a.updated_at as updated_at
       FROM jobs j
       JOIN applications a ON a.job_id = j.id
       ORDER BY a.updated_at ASC`,
    )
    .all();
  return rows.map(rowToJob);
}

export function getStatusHistory(
  db: Database,
  jobId: number,
): { status: string; at: number }[] {
  return db
    .query<{ status: string; at: number }, [number]>(
      "SELECT status, at FROM status_history WHERE job_id = ? ORDER BY at ASC",
    )
    .all(jobId);
}

/**
 * Wipes the status_history timeline for a job — current status/notes in
 * `applications` are untouched, only the audit-trail log is cleared. Note
 * this also clears `undoLastStatus`'s ability to walk back further, since
 * there's nothing left to walk back to. Returns the number of rows deleted.
 */
export function clearStatusHistory(db: Database, jobId: number): number {
  const result = db.query("DELETE FROM status_history WHERE job_id = ?").run(jobId);
  return result.changes;
}
