import type { JobRecord } from "./db/repo.ts";

const CSV_COLUMNS: (keyof JobRecord | "locationsCsv" | "extraCsv")[] = [
  "id",
  "sourceId",
  "sourceJobId",
  "company",
  "title",
  "url",
  "locationsCsv",
  "workModel",
  "datePosted",
  "active",
  "extraCsv",
  "firstSeenAt",
  "lastSeenAt",
  "status",
  "notes",
  "updatedAt",
];

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Full backup export (§ "missing feature: export/backup") — every job,
 * not just tracked ones, since the DB is the system of record (§0) and
 * this is meant as insurance/portability beyond the raw sqlite file.
 */
export function exportJobsToCsv(jobs: JobRecord[]): string {
  const header = [
    "id",
    "sourceId",
    "sourceJobId",
    "company",
    "title",
    "url",
    "locations",
    "workModel",
    "datePosted",
    "active",
    "extra",
    "firstSeenAt",
    "lastSeenAt",
    "status",
    "notes",
    "updatedAt",
  ];
  const rows = jobs.map((j) => {
    const record: Record<string, unknown> = {
      ...j,
      locationsCsv: j.locations.join("; "),
      extraCsv: JSON.stringify(j.extra),
    };
    return CSV_COLUMNS.map((c) => csvEscape(record[c])).join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}

export function exportJobsToJson(jobs: JobRecord[]): string {
  return JSON.stringify(jobs, null, 2) + "\n";
}

export type ExportFormat = "csv" | "json";

export function formatFromPath(path: string): ExportFormat | null {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".csv")) return "csv";
  return null;
}
