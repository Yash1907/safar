import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, getMeta } from "../src/db/schema.ts";
import { listJobs } from "../src/db/repo.ts";
import { syncAll, syncSource, formatSyncSummary } from "../src/sync.ts";
import type { RawJob, SourceAdapter } from "../src/sources/types.ts";

function freshDb(): Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

function fakeAdapter(id: string, jobs: RawJob[] | (() => RawJob[])): SourceAdapter {
  return {
    id,
    displayName: `Fake ${id}`,
    async fetch() {
      return typeof jobs === "function" ? jobs() : jobs;
    },
  };
}

function job(overrides: Partial<RawJob> = {}): RawJob {
  return {
    sourceId: "fake",
    sourceJobId: "1",
    company: "Acme",
    title: "Engineer",
    url: "https://example.com",
    locations: ["Remote"],
    ...overrides,
  };
}

describe("syncSource", () => {
  test("dedups on (sourceId, sourceJobId): re-syncing the same row updates, doesn't duplicate", async () => {
    const db = freshDb();
    const adapter = fakeAdapter("fake", [job({ sourceJobId: "abc", title: "v1" })]);

    const r1 = await syncSource(db, adapter, new Date());
    expect(r1.newCount).toBe(1);
    expect(r1.updatedCount).toBe(0);

    const adapter2 = fakeAdapter("fake", [job({ sourceJobId: "abc", title: "v2" })]);
    const r2 = await syncSource(db, adapter2, new Date());
    expect(r2.newCount).toBe(0);
    expect(r2.updatedCount).toBe(1);

    const rows = listJobs(db, { active: "any" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("v2");
  });

  test("first_seen_at is set once on insert and never changes on update", async () => {
    const db = freshDb();
    const t1 = new Date(2026, 0, 1);
    const t2 = new Date(2026, 0, 5);

    await syncSource(db, fakeAdapter("fake", [job({ sourceJobId: "x" })]), t1);
    const afterFirst = listJobs(db, { active: "any" })[0]!;

    await syncSource(db, fakeAdapter("fake", [job({ sourceJobId: "x", title: "updated" })]), t2);
    const afterSecond = listJobs(db, { active: "any" })[0]!;

    expect(afterSecond.firstSeenAt).toBe(afterFirst.firstSeenAt);
    expect(afterSecond.lastSeenAt).toBeGreaterThan(afterFirst.lastSeenAt);
  });

  test("stores per-source last_sync_at in meta after a successful sync", async () => {
    const db = freshDb();
    const now = new Date(2026, 0, 10);
    await syncSource(db, fakeAdapter("fake", [job()]), now);
    const stored = getMeta(db, "last_sync_at:fake");
    expect(stored).toBe(String(Math.floor(now.getTime() / 1000)));
  });

  test("a failing adapter reports an error and does not write last_sync_at", async () => {
    const db = freshDb();
    const failing: SourceAdapter = {
      id: "broken",
      displayName: "Broken Source",
      async fetch() {
        throw new Error("network down");
      },
    };
    const result = await syncSource(db, failing, new Date());
    expect(result.error).toBe("network down");
    expect(getMeta(db, "last_sync_at:broken")).toBeNull();
  });

  test("skipped rows reported via ctx.reportSkipped are surfaced in the result", async () => {
    const db = freshDb();
    const adapter: SourceAdapter = {
      id: "src",
      displayName: "Src",
      async fetch(ctx) {
        ctx.reportSkipped?.(3);
        return [job()];
      },
    };
    const result = await syncSource(db, adapter, new Date());
    expect(result.skippedRows).toBe(3);
  });
});

describe("syncAll", () => {
  test("one source failing does not abort the others", async () => {
    const db = freshDb();
    const good = fakeAdapter("good", [job({ sourceId: "good", sourceJobId: "1" })]);
    const bad: SourceAdapter = {
      id: "bad",
      displayName: "Bad",
      async fetch() {
        throw new Error("boom");
      },
    };
    const results = await syncAll(db, [good, bad], new Date());
    expect(results).toHaveLength(2);
    expect(results[0]!.error).toBeUndefined();
    expect(results[0]!.newCount).toBe(1);
    expect(results[1]!.error).toBe("boom");

    // The good source's row still made it in despite the bad source failing.
    const rows = listJobs(db, { active: "any", sourceId: "good" });
    expect(rows).toHaveLength(1);
  });

  test("formatSyncSummary renders a readable per-source line, including errors", async () => {
    const db = freshDb();
    const good = fakeAdapter("good", [job({ sourceId: "good", sourceJobId: "1" })]);
    const bad: SourceAdapter = {
      id: "bad",
      displayName: "Bad Source",
      async fetch() {
        throw new Error("boom");
      },
    };
    const results = await syncAll(db, [good, bad], new Date());
    const summary = formatSyncSummary(results);
    expect(summary).toContain("+1 new");
    expect(summary).toContain("Bad Source: error — boom");
  });
});
