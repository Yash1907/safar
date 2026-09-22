import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db/schema.ts";
import {
  recordSkippedJob,
  deleteSkippedJob,
  isJobSkipped,
  listSkippedJobs,
  listApplicationsForDay,
  setStatus,
} from "../src/db/repo.ts";

describe("skipped jobs repo operations", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    db.exec(`
      INSERT INTO jobs (id, source_id, source_job_id, company, title, url, first_seen_at, last_seen_at, date_posted)
      VALUES (1, 's1', '1', 'Acme', 'SWE 1', 'https://workday.com/1', 1000, 1000, 1000),
             (2, 's2', '2', 'Beta', 'SWE 2', 'https://lever.co/2', 2000, 2000, 2000)
    `);
  });

  afterEach(() => {
    db.close();
  });

  it("records and lists skipped jobs with reasons", () => {
    recordSkippedJob(db, 1, "Unsupported ATS (workday)", 1000);
    expect(isJobSkipped(db, 1)).toBe(true);
    expect(isJobSkipped(db, 2)).toBe(false);

    const skipped = listSkippedJobs(db);
    expect(skipped.length).toBe(1);
    expect(skipped[0]!.id).toBe(1);
    expect(skipped[0]!.company).toBe("Acme");
    expect(skipped[0]!.skipReason).toBe("Unsupported ATS (workday)");
  });

  it("deletes a skipped job explicitly", () => {
    recordSkippedJob(db, 1, "Custom question", 1000);
    expect(isJobSkipped(db, 1)).toBe(true);
    deleteSkippedJob(db, 1);
    expect(isJobSkipped(db, 1)).toBe(false);
  });

  it("automatically removes job from skipped_jobs when applied", () => {
    recordSkippedJob(db, 1, "Custom question", 1000);
    expect(isJobSkipped(db, 1)).toBe(true);

    setStatus(db, 1, "applied", 1500);
    expect(isJobSkipped(db, 1)).toBe(false);
    expect(listSkippedJobs(db).length).toBe(0);
  });

  it("lists applications submitted within a given time range for daily report", () => {
    setStatus(db, 1, "applied", 500);
    setStatus(db, 2, "applied", 1500);

    const apps = listApplicationsForDay(db, 1000, 2000);
    expect(apps.length).toBe(1);
    expect(apps[0]!.id).toBe(2);
    expect(apps[0]!.company).toBe("Beta");
  });
});
