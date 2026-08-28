import type { Database } from "bun:sqlite";
import {
  deleteApplication,
  type ApplicationStatus,
  type JobRecord,
} from "./db/repo.ts";
import { groupTrackedJobs } from "./tracker.ts";
import { detectJobSite } from "./site.ts";

export const SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const HEADER_ROW = [
  "Company",
  "Title",
  "Status",
  "Notes",
  "Location",
  "Site",
  "URL",
  "Date Posted",
  "Last Updated",
];

const STATUS_ALIASES: Record<string, ApplicationStatus> = {
  saved: "saved",
  save: "saved",
  applied: "applied",
  apply: "applied",
  oa: "oa",
  "online assessment": "oa",
  assessment: "oa",
  interviewing: "interviewing",
  interview: "interviewing",
  offer: "offer",
  offered: "offer",
  rejected: "rejected",
  reject: "rejected",
  withdrawn: "withdrawn",
  withdraw: "withdrawn",
  withdrew: "withdrawn",
};

export function normalizeStatus(raw: string): ApplicationStatus | null {
  const trimmed = raw.trim().toLowerCase();
  return STATUS_ALIASES[trimmed] ?? null;
}

export interface ParsedSheetJob {
  company: string;
  title: string;
  status: ApplicationStatus;
  notes: string;
  locations: string[];
  url: string;
  datePosted: number | null;
  updatedAt: number;
}

/**
 * Formats tracked jobs as sheet rows — same status-lifecycle grouping and
 * ordering as the Tracker view, so the sheet reads like a mirror of it.
 * Pure/no network, so directly testable.
 */
export function rowsForSheet(jobs: JobRecord[]): (string | number)[][] {
  const rows: (string | number)[][] = [HEADER_ROW];
  for (const group of groupTrackedJobs(jobs)) {
    for (const job of group.jobs) {
      rows.push([
        job.company,
        job.title,
        job.status ?? "",
        job.notes ?? "",
        job.locations.join("; "),
        detectJobSite(job.url).label,
        job.url,
        job.datePosted ? new Date(job.datePosted * 1000).toISOString().slice(0, 10) : "",
        job.updatedAt ? new Date(job.updatedAt * 1000).toISOString() : "",
      ]);
    }
  }
  return rows;
}

/**
 * Parses 2D array of cells from Google Sheets into structured job records.
 * Dynamically resolves column positions from header names if present,
 * falling back to HEADER_ROW order. Pure/no network, so directly testable.
 */
export function parseSheetRows(rows: (string | number)[][]): ParsedSheetJob[] {
  if (rows.length === 0) return [];

  let col = {
    company: 0,
    title: 1,
    status: 2,
    notes: 3,
    location: 4,
    site: 5,
    url: 6,
    datePosted: 7,
    lastUpdated: 8,
  };

  let startIndex = 0;
  const firstRow = rows[0] ?? [];
  const firstRowStrings = firstRow.map((c) => String(c).trim().toLowerCase());

  const hasHeader =
    firstRowStrings.some((c) => c.includes("status")) ||
    firstRowStrings.some((c) => c.includes("company"));

  if (hasHeader) {
    startIndex = 1;
    const findCol = (pattern: RegExp) => firstRowStrings.findIndex((s) => pattern.test(s));
    const companyIdx = findCol(/company/);
    const titleIdx = findCol(/title|role|position/);
    const statusIdx = findCol(/status/);
    const notesIdx = findCol(/notes|note/);
    const locationIdx = findCol(/location/);
    const siteIdx = findCol(/site/);
    const urlIdx = findCol(/url|link/);
    const datePostedIdx = findCol(/posted/);
    const lastUpdatedIdx = findCol(/updated/);

    col = {
      company: companyIdx >= 0 ? companyIdx : col.company,
      title: titleIdx >= 0 ? titleIdx : col.title,
      status: statusIdx >= 0 ? statusIdx : col.status,
      notes: notesIdx >= 0 ? notesIdx : col.notes,
      location: locationIdx >= 0 ? locationIdx : col.location,
      site: siteIdx >= 0 ? siteIdx : col.site,
      url: urlIdx >= 0 ? urlIdx : col.url,
      datePosted: datePostedIdx >= 0 ? datePostedIdx : col.datePosted,
      lastUpdated: lastUpdatedIdx >= 0 ? lastUpdatedIdx : col.lastUpdated,
    };
  }

  const jobs: ParsedSheetJob[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i]!;
    const getCell = (idx: number): string => String(row[idx] ?? "").trim();

    const rawStatus = getCell(col.status);
    const status = normalizeStatus(rawStatus);
    if (!status) {
      continue;
    }

    const company = getCell(col.company);
    const title = getCell(col.title);
    const url = getCell(col.url);

    if (!company && !title && !url) {
      continue;
    }

    const notes = getCell(col.notes);
    const locationStr = getCell(col.location);
    const locations = locationStr
      ? locationStr.split(";").map((s) => s.trim()).filter(Boolean)
      : [];

    const datePostedStr = getCell(col.datePosted);
    let datePosted: number | null = null;
    if (datePostedStr) {
      const parsedMs = Date.parse(datePostedStr);
      if (!isNaN(parsedMs)) {
        datePosted = Math.floor(parsedMs / 1000);
      }
    }

    const lastUpdatedStr = getCell(col.lastUpdated);
    let updatedAt = nowSec;
    if (lastUpdatedStr) {
      const parsedMs = Date.parse(lastUpdatedStr);
      if (!isNaN(parsedMs)) {
        updatedAt = Math.floor(parsedMs / 1000);
      }
    }

    jobs.push({
      company,
      title,
      status,
      notes,
      locations,
      url,
      datePosted,
      updatedAt,
    });
  }

  return jobs;
}

async function checkOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    throw new Error(`Sheets ${action} failed: ${res.status} ${await res.text()}`);
  }
}

/** Clears every cell currently in the sheet, so a shrunk tracked-job list doesn't leave stale rows behind. */
export async function clearSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
): Promise<void> {
  const range = encodeURIComponent(sheetName);
  const res = await fetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}:clear`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  await checkOk(res, "clear");
}

export async function writeSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  rows: (string | number)[][],
): Promise<void> {
  const rangeLabel = `${sheetName}!A1`;
  const res = await fetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeLabel)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ range: rangeLabel, majorDimension: "ROWS", values: rows }),
    },
  );
  await checkOk(res, "write");
}

export async function readSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
): Promise<(string | number)[][]> {
  const range = encodeURIComponent(sheetName);
  const res = await fetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  await checkOk(res, "read");
  const data = (await res.json()) as { values?: (string | number)[][] };
  return data.values ?? [];
}

/**
 * Pushes tracked jobs to Google Sheets: clears the whole sheet, then rewrites it
 * fresh from the current tracked-job list.
 */
export async function pushTrackedJobsToSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  jobs: JobRecord[],
): Promise<{ rowCount: number }> {
  const rows = rowsForSheet(jobs);
  await clearSheet(accessToken, spreadsheetId, sheetName);
  await writeSheet(accessToken, spreadsheetId, sheetName, rows);
  return { rowCount: rows.length - 1 }; // exclude header row
}

export interface ApplySheetJobsResult {
  pulledCount: number;
  untrackedCount: number;
  createdJobCount: number;
}

/**
 * Updates local SQLite DB from parsed sheet jobs.
 * - Matches jobs by URL (or company + title), creating a new row in `jobs` if not found.
 * - Upserts applications and appends to status_history on status transitions.
 * - Untracks local jobs that are NOT present in the sheet (Mirror Sheets).
 */
export function applySheetJobsToDb(
  db: Database,
  sheetJobs: ParsedSheetJob[],
): ApplySheetJobsResult {
  return db.transaction(() => {
    const pulledJobIds = new Set<number>();
    let createdJobCount = 0;

    for (const item of sheetJobs) {
      let jobId: number | null = null;

      // 1. Try matching by exact URL
      if (item.url) {
        const urlMatch = db
          .query<{ id: number }, [string]>(
            `SELECT j.id FROM jobs j
             LEFT JOIN applications a ON a.job_id = j.id
             WHERE j.url = ?
             ORDER BY (a.job_id IS NOT NULL) DESC, j.id ASC`,
          )
          .get(item.url);
        if (urlMatch) {
          jobId = urlMatch.id;
        } else {
          const trimmedUrl = item.url.replace(/\/+$/, "");
          const trimmedMatch = db
            .query<{ id: number }, [string, string]>(
              `SELECT j.id FROM jobs j
               LEFT JOIN applications a ON a.job_id = j.id
               WHERE j.url = ? OR j.url = ?
               ORDER BY (a.job_id IS NOT NULL) DESC, j.id ASC`,
            )
            .get(trimmedUrl, trimmedUrl + "/");
          if (trimmedMatch) {
            jobId = trimmedMatch.id;
          }
        }
      }

      // 2. If no URL match, try matching by company and title (case-insensitive)
      if (jobId === null && item.company && item.title) {
        const titleMatch = db
          .query<{ id: number }, [string, string]>(
            `SELECT j.id FROM jobs j
             LEFT JOIN applications a ON a.job_id = j.id
             WHERE LOWER(j.company) = LOWER(?) AND LOWER(j.title) = LOWER(?)
             ORDER BY (a.job_id IS NOT NULL) DESC, j.id ASC`,
          )
          .get(item.company, item.title);
        if (titleMatch) {
          jobId = titleMatch.id;
        }
      }

      // 3. If still no match, create a job in `jobs` so we can track it
      if (jobId === null) {
        const now = Math.floor(Date.now() / 1000);
        const sourceJobId =
          item.url || `sheets-${item.company}-${item.title}-${now}-${pulledJobIds.size}`;
        const insertRes = db
          .query(
            `INSERT INTO jobs
               (source_id, source_job_id, company, title, url, locations, work_model,
                date_posted, active, extra, first_seen_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source_id, source_job_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
          )
          .run(
            "sheets",
            sourceJobId,
            item.company || "Unknown Company",
            item.title || "Unknown Title",
            item.url || "",
            JSON.stringify(item.locations),
            null,
            item.datePosted,
            1,
            "{}",
            item.updatedAt || now,
            item.updatedAt || now,
          );
        if (insertRes.lastInsertRowid) {
          jobId = Number(insertRes.lastInsertRowid);
        } else {
          const existing = db
            .query<{ id: number }, [string, string]>(
              "SELECT id FROM jobs WHERE source_id = ? AND source_job_id = ?",
            )
            .get("sheets", sourceJobId);
          jobId = existing!.id;
        }
        createdJobCount++;
      }

      pulledJobIds.add(jobId);

      // Upsert application and record in status_history
      const existingApp = db
        .query<{ status: string; notes: string; updated_at: number }, [number]>(
          "SELECT status, notes, updated_at FROM applications WHERE job_id = ?",
        )
        .get(jobId);

      if (!existingApp) {
        db.query(
          "INSERT INTO applications (job_id, status, notes, updated_at) VALUES (?, ?, ?, ?)",
        ).run(jobId, item.status, item.notes, item.updatedAt);
        db.query(
          "INSERT INTO status_history (job_id, status, at) VALUES (?, ?, ?)",
        ).run(jobId, item.status, item.updatedAt);
      } else {
        db.query(
          "UPDATE applications SET status = ?, notes = ?, updated_at = ? WHERE job_id = ?",
        ).run(item.status, item.notes, item.updatedAt, jobId);

        const hist = db
          .query<{ id: number }, [number]>(
            "SELECT id FROM status_history WHERE job_id = ? LIMIT 1",
          )
          .get(jobId);
        if (!hist || existingApp.status !== item.status) {
          db.query(
            "INSERT INTO status_history (job_id, status, at) VALUES (?, ?, ?)",
          ).run(jobId, item.status, item.updatedAt);
        }
      }
    }

    // Mirror Sheets: Untrack local jobs that are NOT in the sheet
    const allTracked = db
      .query<{ job_id: number }, []>("SELECT job_id FROM applications")
      .all();

    let untrackedCount = 0;
    for (const app of allTracked) {
      if (!pulledJobIds.has(app.job_id)) {
        deleteApplication(db, app.job_id);
        untrackedCount++;
      }
    }

    return {
      pulledCount: pulledJobIds.size,
      untrackedCount,
      createdJobCount,
    };
  })();
}

/**
 * Pulls tracked jobs from Google Sheets and mirrors them to local SQLite DB:
 * reads the sheet, parses rows, updates applications, and untracks any local
 * jobs not in the sheet.
 */
export async function pullTrackedJobsFromSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  db: Database,
): Promise<ApplySheetJobsResult> {
  const rows = await readSheet(accessToken, spreadsheetId, sheetName);
  if (rows.length === 0) {
    throw new Error(
      `Google Sheet "${sheetName}" is empty — push with Shift+S first before pulling`,
    );
  }
  const parsedJobs = parseSheetRows(rows);
  return applySheetJobsToDb(db, parsedJobs);
}
