import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db/schema.ts";
import { setStatus, type JobRecord } from "../src/db/repo.ts";
import { autoApplySingleJob } from "../src/applier/engine.ts";

describe("autoApplySingleJob", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    db.exec(`
      INSERT INTO jobs (id, source_id, source_job_id, company, title, url, first_seen_at, last_seen_at, date_posted)
      VALUES (1, 's1', '1', 'Acme Corp', 'SWE Intern', 'https://boards.greenhouse.io/acme/jobs/1', 1000, 1000, 1000),
             (2, 's2', '2', 'Beta Inc', 'Senior Engineer', 'https://jobs.lever.co/beta/2', 2000, 2000, 2000),
             (3, 's3', '3', 'Gamma Inc', 'SWE New Grad', 'https://jobs.ashbyhq.com/gamma/3', 3000, 3000, 3000)
    `);
  });

  afterEach(() => {
    db.close();
  });

  it("fails early with reason if job is already marked applied", async () => {
    setStatus(db, 1, "applied", 1200);

    const job: JobRecord = {
      id: 1,
      sourceId: "s1",
      company: "Acme Corp",
      title: "SWE Intern",
      url: "https://boards.greenhouse.io/acme/jobs/1",
      locations: [],
      active: true,
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      status: "applied",
    };

    const res = await autoApplySingleJob(db, job);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("Already applied");
    expect(res.roleType).toBe("intern");
  });

  it("fails early if platform is not Greenhouse or Ashby", async () => {
    const job: JobRecord = {
      id: 2,
      sourceId: "s2",
      company: "Beta Inc",
      title: "Senior Engineer",
      url: "https://jobs.lever.co/beta/2",
      locations: [],
      active: true,
      firstSeenAt: 2000,
      lastSeenAt: 2000,
      status: null,
    };

    const res = await autoApplySingleJob(db, job);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("Unsupported platform");
    expect(res.roleType).toBe("fulltime");
  });

  it("detects roleType correctly for intern vs fulltime in autoApplySingleJob", async () => {
    const internJob: JobRecord = {
      id: 1,
      sourceId: "s1",
      company: "Acme Corp",
      title: "SWE Co-op / Intern",
      url: "https://workday.com/1",
      locations: [],
      active: true,
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      status: null,
    };
    const resIntern = await autoApplySingleJob(db, internJob);
    expect(resIntern.roleType).toBe("intern");

    const ftJob: JobRecord = {
      id: 3,
      sourceId: "s3",
      company: "Gamma Inc",
      title: "Software Engineer New Grad",
      url: "https://workday.com/3",
      locations: [],
      active: true,
      firstSeenAt: 3000,
      lastSeenAt: 3000,
      status: null,
    };
    const resFt = await autoApplySingleJob(db, ftJob);
    expect(resFt.roleType).toBe("fulltime");
  });
});
