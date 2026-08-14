import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db/schema.ts";
import { upsertJob, setStatus, listTrackedJobs } from "../src/db/repo.ts";
import { groupTrackedJobs, flattenGroups } from "../src/tracker.ts";
import type { RawJob } from "../src/sources/types.ts";

function freshDb(): Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

function job(id: string, overrides: Partial<RawJob> = {}): RawJob {
  return {
    sourceId: "fake",
    sourceJobId: id,
    company: `Company ${id}`,
    title: "Engineer",
    url: "https://example.com",
    locations: ["Remote"],
    ...overrides,
  };
}

describe("listTrackedJobs / groupTrackedJobs", () => {
  test("only jobs with an application row are tracked, in lifecycle order", () => {
    const db = freshDb();
    upsertJob(db, job("a"), 100);
    upsertJob(db, job("b"), 100);
    upsertJob(db, job("c"), 100);

    const jobA = db.query<{ id: number }, []>("SELECT id FROM jobs WHERE source_job_id='a'").get()!;
    const jobB = db.query<{ id: number }, []>("SELECT id FROM jobs WHERE source_job_id='b'").get()!;
    // "c" is never tracked — should not appear.

    setStatus(db, jobA.id, "interviewing", 200);
    setStatus(db, jobB.id, "applied", 150);

    const tracked = listTrackedJobs(db);
    expect(tracked).toHaveLength(2);

    const groups = groupTrackedJobs(tracked);
    expect(groups.map((g) => g.status)).toEqual(["applied", "interviewing"]);
  });

  test("within a group, oldest-updated job sorts first (stale surfaces first)", () => {
    const db = freshDb();
    upsertJob(db, job("a"), 100);
    upsertJob(db, job("b"), 100);
    const jobA = db.query<{ id: number }, []>("SELECT id FROM jobs WHERE source_job_id='a'").get()!;
    const jobB = db.query<{ id: number }, []>("SELECT id FROM jobs WHERE source_job_id='b'").get()!;

    setStatus(db, jobA.id, "applied", 500); // updated more recently
    setStatus(db, jobB.id, "applied", 100); // stalest

    const groups = groupTrackedJobs(listTrackedJobs(db));
    const applied = groups.find((g) => g.status === "applied")!;
    expect(applied.jobs.map((j) => j.sourceJobId)).toEqual(["b", "a"]);
  });

  test("Tracker ignores the active filter — an inactive tracked job still appears", () => {
    const db = freshDb();
    upsertJob(db, job("dead", { active: false }), 100);
    const rec = db.query<{ id: number }, []>("SELECT id FROM jobs WHERE source_job_id='dead'").get()!;
    setStatus(db, rec.id, "rejected", 100);

    const tracked = listTrackedJobs(db);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.active).toBe(false);
  });

  test("empty statuses produce no group (flattenGroups matches display order)", () => {
    const db = freshDb();
    upsertJob(db, job("a"), 100);
    const rec = db.query<{ id: number }, []>("SELECT id FROM jobs WHERE source_job_id='a'").get()!;
    setStatus(db, rec.id, "offer", 100);

    const groups = groupTrackedJobs(listTrackedJobs(db));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.status).toBe("offer");
    expect(flattenGroups(groups).map((j) => j.sourceJobId)).toEqual(["a"]);
  });
});
