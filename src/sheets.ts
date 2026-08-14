import type { JobRecord } from "./db/repo.ts";
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

/**
 * One-way push (§ "sync tracked jobs to Google Sheets" — one-way only,
 * v1): clears the whole sheet, then rewrites it fresh from the current
 * tracked-job list. The DB stays the system of record; the sheet is a
 * generated mirror, never read back.
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
