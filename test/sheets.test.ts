import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db/schema.ts";
import {
  rowsForSheet,
  clearSheet,
  writeSheet,
  readSheet,
  pushTrackedJobsToSheet,
  pullTrackedJobsFromSheet,
  parseSheetRows,
  normalizeStatus,
  applySheetJobsToDb,
} from "../src/sheets.ts";
import { listTrackedJobs, getJob, getStatusHistory, setStatus, setNotes } from "../src/db/repo.ts";
import type { JobRecord } from "../src/db/repo.ts";

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 1,
    sourceId: "simplify-newgrad",
    sourceJobId: "1",
    company: "Acme",
    title: "Software Engineer",
    url: "https://jobs.ashbyhq.com/acme/swe",
    locations: ["Remote", "NYC"],
    workModel: "remote",
    datePosted: 1_700_000_000,
    active: true,
    extra: {},
    firstSeenAt: 100,
    lastSeenAt: 100,
    status: "applied",
    notes: null,
    updatedAt: 1_700_000_500,
    ...overrides,
  };
}

describe("rowsForSheet", () => {
  test("header row matches the documented column order", () => {
    const [header] = rowsForSheet([]);
    expect(header).toEqual([
      "Company",
      "Title",
      "Status",
      "Notes",
      "Location",
      "Site",
      "URL",
      "Date Posted",
      "Last Updated",
    ]);
  });

  test("untracked jobs (no status) are excluded", () => {
    const rows = rowsForSheet([job({ status: null })]);
    expect(rows).toHaveLength(1); // header only
  });

  test("one row per tracked job, grouped/ordered like the Tracker view", () => {
    const rows = rowsForSheet([
      job({ id: 1, company: "A", status: "rejected" }),
      job({ id: 2, company: "B", status: "applied" }),
    ]);
    // applied sorts before rejected in STATUS_ORDER
    expect(rows.slice(1).map((r) => r[0])).toEqual(["B", "A"]);
  });

  test("site is derived from the job's URL", () => {
    const rows = rowsForSheet([job({ url: "https://boards.greenhouse.io/acme/jobs/1" })]);
    expect(rows[1]![5]).toBe("greenhouse");
  });

  test("locations join with '; ', notes/dates render as empty string not null/undefined", () => {
    const rows = rowsForSheet([
      job({ locations: ["Remote", "NYC"], notes: null, datePosted: null, updatedAt: null }),
    ]);
    const row = rows[1]!;
    expect(row[4]).toBe("Remote; NYC");
    expect(row[3]).toBe("");
    expect(row[7]).toBe("");
    expect(row[8]).toBe("");
  });
});

describe("Sheets REST calls (request shape, no real network)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("clearSheet POSTs to the values:clear endpoint with a bearer token", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), init };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await clearSheet("tok123", "sheet-id", "Tracker");

    expect(captured!.url).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/Tracker:clear",
    );
    expect(captured!.init.method).toBe("POST");
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
  });

  test("clearSheet throws with status + body on a non-ok response", async () => {
    globalThis.fetch = (async () =>
      new Response("permission denied", { status: 403 })) as unknown as typeof fetch;
    await expect(clearSheet("tok", "id", "Tracker")).rejects.toThrow(/403/);
  });

  test("writeSheet PUTs values with valueInputOption=RAW and the right range", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), init };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await writeSheet("tok123", "sheet-id", "Tracker", [["a", "b"]]);

    expect(captured!.url).toContain("values/Tracker!A1");
    expect(captured!.url).toContain("valueInputOption=RAW");
    expect(captured!.init.method).toBe("PUT");
    const body = JSON.parse(captured!.init.body as string);
    expect(body.values).toEqual([["a", "b"]]);
    expect(body.range).toBe("Tracker!A1");
  });

  test("pushTrackedJobsToSheet clears then writes, and reports the row count", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${String(url).includes(":clear") ? "clear" : "write"}`);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await pushTrackedJobsToSheet("tok", "id", "Tracker", [
      job({ id: 1, status: "applied" }),
      job({ id: 2, status: null }), // untracked, excluded
    ]);

    expect(calls).toEqual(["POST clear", "PUT write"]);
    expect(result.rowCount).toBe(1);
  });

  test("readSheet GETs values with a bearer token and returns values array", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          values: [
            ["Company", "Title", "Status"],
            ["Acme", "SWE", "applied"],
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const rows = await readSheet("tok123", "sheet-id", "Tracker");

    expect(captured!.url).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/Tracker",
    );
    expect(captured!.init.method).toBe("GET");
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
    expect(rows).toEqual([
      ["Company", "Title", "Status"],
      ["Acme", "SWE", "applied"],
    ]);
  });

  test("readSheet returns empty array when values is undefined", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;

    const rows = await readSheet("tok", "sheet-id", "Tracker");
    expect(rows).toEqual([]);
  });

  test("pullTrackedJobsFromSheet throws if sheet is completely empty", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ values: [] }), { status: 200 })) as unknown as typeof fetch;

    const db = new Database(":memory:");
    migrate(db);

    await expect(pullTrackedJobsFromSheet("tok", "sheet-id", "Tracker", db)).rejects.toThrow(
      /is empty/,
    );
  });
});

describe("normalizeStatus", () => {
  test("normalizes status casing and whitespace", () => {
    expect(normalizeStatus("APPLIED")).toBe("applied");
    expect(normalizeStatus("  Saved  ")).toBe("saved");
    expect(normalizeStatus("oa")).toBe("oa");
    expect(normalizeStatus("OA")).toBe("oa");
  });

  test("recognizes common aliases", () => {
    expect(normalizeStatus("interview")).toBe("interviewing");
    expect(normalizeStatus("online assessment")).toBe("oa");
    expect(normalizeStatus("offered")).toBe("offer");
    expect(normalizeStatus("reject")).toBe("rejected");
    expect(normalizeStatus("withdrew")).toBe("withdrawn");
  });

  test("returns null for invalid or empty status", () => {
    expect(normalizeStatus("")).toBeNull();
    expect(normalizeStatus("unknown")).toBeNull();
    expect(normalizeStatus("not a status")).toBeNull();
  });
});

describe("parseSheetRows", () => {
  test("returns empty array for empty rows", () => {
    expect(parseSheetRows([])).toEqual([]);
  });

  test("parses rows matching standard rowsForSheet format", () => {
    const exportedRows = rowsForSheet([
      job({
        company: "Stripe",
        title: "Frontend Engineer",
        status: "interviewing",
        notes: "round 2 on monday",
        locations: ["Remote", "SF"],
        url: "https://stripe.com/jobs/1",
        datePosted: 1_700_000_000,
        updatedAt: 1_700_000_100,
      }),
    ]);

    const parsed = parseSheetRows(exportedRows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.company).toBe("Stripe");
    expect(parsed[0]!.title).toBe("Frontend Engineer");
    expect(parsed[0]!.status).toBe("interviewing");
    expect(parsed[0]!.notes).toBe("round 2 on monday");
    expect(parsed[0]!.locations).toEqual(["Remote", "SF"]);
    expect(parsed[0]!.url).toBe("https://stripe.com/jobs/1");
    // datePosted in sheets is formatted as YYYY-MM-DD, so it parses to UTC midnight
    expect(parsed[0]!.datePosted).toBe(1_699_920_000);
    expect(parsed[0]!.updatedAt).toBe(1_700_000_100);
  });

  test("skips rows with missing or invalid status", () => {
    const rows = [
      ["Company", "Title", "Status", "Notes", "Location", "Site", "URL"],
      ["Valid", "SWE", "applied", "", "", "", "https://valid.com"],
      ["Invalid", "SWE", "invalid_status", "", "", "", "https://invalid.com"],
      ["NoStatus", "SWE", "", "", "", "", "https://nostatus.com"],
    ];
    const parsed = parseSheetRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.company).toBe("Valid");
  });

  test("handles reordered columns via dynamic header detection", () => {
    const rows = [
      ["Status", "URL", "Company", "Title"],
      ["applied", "https://reordered.com", "Acme", "Lead SWE"],
    ];
    const parsed = parseSheetRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.company).toBe("Acme");
    expect(parsed[0]!.title).toBe("Lead SWE");
    expect(parsed[0]!.status).toBe("applied");
    expect(parsed[0]!.url).toBe("https://reordered.com");
  });

  test("tolerates rows with fewer cells than header", () => {
    const rows = [
      ["Company", "Title", "Status", "Notes", "Location", "Site", "URL", "Date Posted", "Last Updated"],
      ["Acme", "SWE", "saved"], // only 3 cells
    ];
    const parsed = parseSheetRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.company).toBe("Acme");
    expect(parsed[0]!.status).toBe("saved");
    expect(parsed[0]!.notes).toBe("");
    expect(parsed[0]!.url).toBe("");
  });
});

describe("applySheetJobsToDb", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });

  test("matches existing job by exact URL and updates application and status_history", () => {
    db.query(
      `INSERT INTO jobs (source_id, source_job_id, company, title, url, locations, first_seen_at, last_seen_at)
       VALUES ('simplify-newgrad', 'job-1', 'Acme', 'SWE', 'https://acme.com/job1', '["Remote"]', 100, 100)`,
    ).run();

    const result = applySheetJobsToDb(db, [
      {
        company: "Acme",
        title: "SWE",
        status: "applied",
        notes: "referred by Alice",
        locations: ["Remote"],
        url: "https://acme.com/job1",
        datePosted: null,
        updatedAt: 1_700_000_000,
      },
    ]);

    expect(result.pulledCount).toBe(1);
    expect(result.createdJobCount).toBe(0);
    expect(result.untrackedCount).toBe(0);

    const tracked = listTrackedJobs(db);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.company).toBe("Acme");
    expect(tracked[0]!.status).toBe("applied");
    expect(tracked[0]!.notes).toBe("referred by Alice");
    expect(tracked[0]!.updatedAt).toBe(1_700_000_000);

    const history = getStatusHistory(db, tracked[0]!.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe("applied");
  });

  test("matches existing job by company and title when URL does not match", () => {
    db.query(
      `INSERT INTO jobs (source_id, source_job_id, company, title, url, locations, first_seen_at, last_seen_at)
       VALUES ('simplify-newgrad', 'job-2', 'Stripe', 'Fullstack Engineer', 'https://stripe.com/old-url', '["NYC"]', 100, 100)`,
    ).run();

    const result = applySheetJobsToDb(db, [
      {
        company: "Stripe",
        title: "Fullstack Engineer",
        status: "oa",
        notes: "hacker rank received",
        locations: ["NYC"],
        url: "https://stripe.com/new-url",
        datePosted: null,
        updatedAt: 1_700_000_500,
      },
    ]);

    expect(result.pulledCount).toBe(1);
    expect(result.createdJobCount).toBe(0);

    const tracked = listTrackedJobs(db);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.company).toBe("Stripe");
    expect(tracked[0]!.status).toBe("oa");
    expect(tracked[0]!.notes).toBe("hacker rank received");
  });

  test("creates missing job with source_id='sheets' when not found locally", () => {
    const result = applySheetJobsToDb(db, [
      {
        company: "NewCorp",
        title: "Staff Platform Engineer",
        status: "saved",
        notes: "found on LinkedIn",
        locations: ["Austin, TX", "Remote"],
        url: "https://newcorp.com/careers/999",
        datePosted: 1_699_000_000,
        updatedAt: 1_700_000_000,
      },
    ]);

    expect(result.pulledCount).toBe(1);
    expect(result.createdJobCount).toBe(1);

    const tracked = listTrackedJobs(db);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.sourceId).toBe("sheets");
    expect(tracked[0]!.company).toBe("NewCorp");
    expect(tracked[0]!.title).toBe("Staff Platform Engineer");
    expect(tracked[0]!.status).toBe("saved");
    expect(tracked[0]!.locations).toEqual(["Austin, TX", "Remote"]);
  });

  test("appends status_history when status transitions on already-tracked job", () => {
    db.query(
      `INSERT INTO jobs (source_id, source_job_id, company, title, url, locations, first_seen_at, last_seen_at)
       VALUES ('simplify-newgrad', 'job-1', 'Acme', 'SWE', 'https://acme.com/job1', '["Remote"]', 100, 100)`,
    ).run();

    setStatus(db, 1, "saved", 1000);

    applySheetJobsToDb(db, [
      {
        company: "Acme",
        title: "SWE",
        status: "interviewing",
        notes: "screening passed",
        locations: ["Remote"],
        url: "https://acme.com/job1",
        datePosted: null,
        updatedAt: 2000,
      },
    ]);

    const history = getStatusHistory(db, 1);
    expect(history.map((h) => h.status)).toEqual(["saved", "interviewing"]);
  });

  test("does not duplicate status_history entry when status is unchanged (only notes updated)", () => {
    db.query(
      `INSERT INTO jobs (source_id, source_job_id, company, title, url, locations, first_seen_at, last_seen_at)
       VALUES ('simplify-newgrad', 'job-1', 'Acme', 'SWE', 'https://acme.com/job1', '["Remote"]', 100, 100)`,
    ).run();

    setStatus(db, 1, "applied", 1000);

    applySheetJobsToDb(db, [
      {
        company: "Acme",
        title: "SWE",
        status: "applied",
        notes: "updated notes only",
        locations: ["Remote"],
        url: "https://acme.com/job1",
        datePosted: null,
        updatedAt: 2000,
      },
    ]);

    const history = getStatusHistory(db, 1);
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe("applied");

    const job = getJob(db, 1);
    expect(job!.notes).toBe("updated notes only");
    expect(job!.updatedAt).toBe(2000);
  });

  test("Mirror Sheets: untracks local jobs that are NOT present in the sheet", () => {
    db.query(
      `INSERT INTO jobs (source_id, source_job_id, company, title, url, locations, first_seen_at, last_seen_at)
       VALUES ('simplify-newgrad', 'job-1', 'Acme', 'SWE', 'https://acme.com/job1', '[]', 100, 100),
              ('simplify-newgrad', 'job-2', 'Beta', 'PM', 'https://beta.com/job2', '[]', 100, 100)`,
    ).run();

    setStatus(db, 1, "applied", 1000);
    setStatus(db, 2, "saved", 1000);

    expect(listTrackedJobs(db)).toHaveLength(2);

    // Sheet only contains Acme (job-1). Beta (job-2) was deleted/untracked on another device.
    const result = applySheetJobsToDb(db, [
      {
        company: "Acme",
        title: "SWE",
        status: "applied",
        notes: "",
        locations: [],
        url: "https://acme.com/job1",
        datePosted: null,
        updatedAt: 1500,
      },
    ]);

    expect(result.pulledCount).toBe(1);
    expect(result.untrackedCount).toBe(1);

    const remainingTracked = listTrackedJobs(db);
    expect(remainingTracked).toHaveLength(1);
    expect(remainingTracked[0]!.id).toBe(1);

    // Beta's job record in `jobs` is still preserved, but its application/history is untracked
    const betaJob = getJob(db, 2);
    expect(betaJob).not.toBeNull();
    expect(betaJob!.status).toBeNull();
    expect(getStatusHistory(db, 2)).toHaveLength(0);
  });
});

describe("store reducer sheets actions", () => {
  test("SHEETS_PULL_START updates statusMessage and sheetsSyncStatus", () => {
    const { reducer, initialState } = require("../src/store.ts");
    const state = initialState();
    const nextState = reducer(state, { type: "SHEETS_PULL_START" });

    expect(nextState.sheetsSyncStatus).toBe("syncing");
    expect(nextState.statusMessage).toBe("pulling from Google Sheets…");
  });

  test("SHEETS_SYNC_DONE updates statusMessage and resets sheetsSyncStatus", () => {
    const { reducer, initialState } = require("../src/store.ts");
    const state = { ...initialState(), sheetsSyncStatus: "syncing" as const };
    const nextState = reducer(state, {
      type: "SHEETS_SYNC_DONE",
      message: "pulled 5 tracked jobs from Google Sheets",
    });

    expect(nextState.sheetsSyncStatus).toBe("idle");
    expect(nextState.statusMessage).toBe("pulled 5 tracked jobs from Google Sheets");
  });
});

