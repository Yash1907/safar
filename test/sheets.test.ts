import { describe, expect, test, afterEach } from "bun:test";
import {
  rowsForSheet,
  clearSheet,
  writeSheet,
  pushTrackedJobsToSheet,
} from "../src/sheets.ts";
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
});
