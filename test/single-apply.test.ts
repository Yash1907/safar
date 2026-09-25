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

  it("fails early in autoApplySingleJob if job does not match explicit filter", async () => {
    const job: JobRecord = {
      id: 2,
      sourceId: "s2",
      company: "Beta Inc",
      title: "Senior Product Manager",
      url: "https://boards.greenhouse.io/beta/2",
      locations: [],
      active: true,
      firstSeenAt: 2000,
      lastSeenAt: 2000,
      status: null,
    };

    const res = await autoApplySingleJob(db, job, {
      filter: "title:forward,software,technology",
    });
    expect(res.success).toBe(false);
    expect(res.reason).toContain('does not match filter "title:forward,software,technology"');
  });

  it("passes filter check in autoApplySingleJob if job matches filter", async () => {
    const job: JobRecord = {
      id: 2,
      sourceId: "s2",
      company: "Beta Inc",
      title: "Forward Deployed Engineer",
      url: "https://jobs.lever.co/beta/2", // Unsupported platform so it reaches platform check after filter
      locations: [],
      active: true,
      firstSeenAt: 2000,
      lastSeenAt: 2000,
      status: null,
    };

    const res = await autoApplySingleJob(db, job, {
      filter: "title:forward,software,technology",
    });
    // Filter passed, so it proceeded to next check (unsupported platform)
    expect(res.success).toBe(false);
    expect(res.reason).toContain("Unsupported platform");
  });
});

describe("runAutoApplyBatch with search query filter", () => {
  let db: Database;
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    db.exec(`
      INSERT INTO jobs (id, source_id, source_job_id, company, title, url, first_seen_at, last_seen_at, date_posted, active)
      VALUES (10, 's1', '10', 'Palantir', 'Forward Deployed Engineer', 'https://jobs.lever.co/palantir/10', ${now}, ${now}, ${now}, 1),
             (20, 's1', '20', 'Google', 'Software Engineer', 'https://jobs.lever.co/google/20', ${now}, ${now}, ${now}, 1),
             (30, 's1', '30', 'TechCorp', 'Technology Analyst', 'https://jobs.lever.co/tech/30', ${now}, ${now}, ${now}, 1),
             (40, 's1', '40', 'Meta', 'Senior Software Engineer', 'https://jobs.lever.co/meta/40', ${now}, ${now}, ${now}, 1),
             (50, 's1', '50', 'SalesCo', 'Human Resources Associate', 'https://jobs.lever.co/sales/50', ${now}, ${now}, ${now}, 1)
    `);
  });

  afterEach(() => {
    db.close();
  });

  it("filters candidate jobs by title:forward,software,technology", async () => {
    const { runAutoApplyBatch } = await import("../src/applier/engine.ts");
    const result = await runAutoApplyBatch(db, {
      lookbackDays: 3,
      dryRun: true,
      filter: "title:forward,software,technology",
    });

    // Palantir (Forward), Google (Software), TechCorp (Technology), Meta (Software) match.
    // SalesCo (HR Associate) does not match.
    expect(result.totalScanned).toBe(4);
    const scannedTitles = result.results.map((r) => r.title);
    expect(scannedTitles).toContain("Forward Deployed Engineer");
    expect(scannedTitles).toContain("Software Engineer");
    expect(scannedTitles).toContain("Technology Analyst");
    expect(scannedTitles).toContain("Senior Software Engineer");
    expect(scannedTitles).not.toContain("Human Resources Associate");
  });

  it("supports boolean exclusions like title:forward,software,technology -title:senior", async () => {
    const { runAutoApplyBatch } = await import("../src/applier/engine.ts");
    const result = await runAutoApplyBatch(db, {
      lookbackDays: 3,
      dryRun: true,
      filter: "title:forward,software,technology -title:senior",
    });

    // Senior Software Engineer excluded by -title:senior
    expect(result.totalScanned).toBe(3);
    const scannedTitles = result.results.map((r) => r.title);
    expect(scannedTitles).toContain("Forward Deployed Engineer");
    expect(scannedTitles).toContain("Software Engineer");
    expect(scannedTitles).toContain("Technology Analyst");
    expect(scannedTitles).not.toContain("Senior Software Engineer");
  });

  it("supports company and location filters", async () => {
    const { runAutoApplyBatch } = await import("../src/applier/engine.ts");
    const result = await runAutoApplyBatch(db, {
      lookbackDays: 3,
      dryRun: true,
      filter: "company:palantir",
    });

    expect(result.totalScanned).toBe(1);
    expect(result.results[0]!.company).toBe("Palantir");
  });

  it("filters candidate jobs to US-only when usOnly is enabled", async () => {
    // Insert UK and Canadian jobs into the test database
    db.exec(`
      INSERT INTO jobs (id, source_id, source_job_id, company, title, url, locations, first_seen_at, last_seen_at, date_posted, active)
      VALUES (60, 's1', '60', 'LondonCo', 'Software Engineer', 'https://jobs.lever.co/london/60', '["London, UK"]', ${now}, ${now}, ${now}, 1),
             (70, 's1', '70', 'TorontoCo', 'Software Engineer', 'https://jobs.lever.co/toronto/70', '["Toronto, ON, Canada"]', ${now}, ${now}, ${now}, 1),
             (80, 's1', '80', 'USCo', 'Software Engineer', 'https://jobs.lever.co/us/80', '["San Francisco, CA"]', ${now}, ${now}, ${now}, 1)
    `);

    const { runAutoApplyBatch } = await import("../src/applier/engine.ts");
    const result = await runAutoApplyBatch(db, {
      lookbackDays: 3,
      dryRun: true,
      usOnly: true,
      filter: "title:software",
    });

    // Only software jobs in the US should match (Google, Meta, USCo)
    // LondonCo, TorontoCo should be excluded by usOnly
    const companies = result.results.map((r) => r.company);
    expect(companies).toContain("Google");
    expect(companies).toContain("Meta");
    expect(companies).toContain("USCo");
    expect(companies).not.toContain("LondonCo");
    expect(companies).not.toContain("TorontoCo");
  });

  it("autoApplySingleJob fails with reason if usOnly is enabled and job is non-US", async () => {
    const ukJob: JobRecord = {
      id: 60,
      sourceId: "s1",
      company: "LondonCo",
      title: "Software Engineer",
      url: "https://boards.greenhouse.io/london/60",
      locations: ["London, UK"],
      active: true,
      firstSeenAt: now,
      lastSeenAt: now,
      status: null,
    };

    const res = await autoApplySingleJob(db, ukJob, { usOnly: true });
    expect(res.success).toBe(false);
    expect(res.reason).toContain("Non-US location (London, UK)");
  });
});


