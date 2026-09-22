import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db/schema.ts";
import { setStatus } from "../src/db/repo.ts";
import {
  normalizeCompany,
  normalizeTitle,
  isJobAlreadyApplied,
} from "../src/dedup.ts";

describe("normalizeCompany", () => {
  it("normalizes company names by stripping corporate suffixes", () => {
    expect(normalizeCompany("SingleStore, Inc.")).toBe("singlestore");
    expect(normalizeCompany("Stripe LLC")).toBe("stripe");
    expect(normalizeCompany("TeleTracking Technologies Corp.")).toBe("teletracking");
    expect(normalizeCompany("Google")).toBe("google");
  });
});

describe("normalizeTitle", () => {
  it("strips brackets, seasons, years, and requisition codes while keeping core role", () => {
    expect(normalizeTitle("Software Engineer Intern - Engine (2026)")).toBe("software engineer intern engine");
    expect(normalizeTitle("Software Engineer Intern - Engine [Summer 2026]")).toBe("software engineer intern engine");
    expect(normalizeTitle("Software Engineer New Grad - Helios [REQ-8220882]")).toBe("software engineer new grad helios");
    expect(normalizeTitle("Frontend Engineer (Remote)")).toBe("frontend engineer");
    expect(normalizeTitle("Software Engineering Co-op")).toBe("software engineering intern");
  });

  it("distinguishes between intern and new grad roles", () => {
    const intern = normalizeTitle("Software Engineer Intern - Engine");
    const newgrad = normalizeTitle("Software Engineer New Grad - Engine");
    expect(intern).not.toBe(newgrad);
  });
});

describe("isJobAlreadyApplied", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns applied=false when no matching application exists", () => {
    db.exec(`
      INSERT INTO jobs (id, source_id, source_job_id, company, title, url, first_seen_at, last_seen_at)
      VALUES (1, 's', '1', 'Stripe', 'Software Engineer', 'https://stripe.com/jobs/1', 100, 100)
    `);

    const result = isJobAlreadyApplied(db, {
      id: 1,
      company: "Stripe",
      title: "Software Engineer",
      url: "https://stripe.com/jobs/1",
    });
    expect(result.applied).toBe(false);
  });

  it("detects exact job ID match when already applied", () => {
    db.exec(`
      INSERT INTO jobs (id, source_id, source_job_id, company, title, url, first_seen_at, last_seen_at)
      VALUES (1, 's', '1', 'Stripe', 'Software Engineer', 'https://stripe.com/jobs/1', 100, 100)
    `);
    setStatus(db, 1, "applied", 100);

    const result = isJobAlreadyApplied(db, {
      id: 1,
      company: "Stripe",
      title: "Software Engineer",
      url: "https://stripe.com/jobs/1",
    });
    expect(result.applied).toBe(true);
    expect(result.reason).toContain("job ID");
  });

  it("detects canonical URL match even with different job IDs", () => {
    db.exec(`
      INSERT INTO jobs (id, source_id, source_job_id, company, title, url, first_seen_at, last_seen_at)
      VALUES (1, 's1', '1', 'Stripe', 'Software Engineer', 'https://stripe.com/jobs/1?src=1', 100, 100),
             (2, 's2', '2', 'Stripe', 'Software Engineer', 'https://stripe.com/jobs/1?utm=foo', 100, 100)
    `);
    setStatus(db, 1, "applied", 100);

    const result = isJobAlreadyApplied(db, {
      id: 2,
      company: "Stripe",
      title: "Software Engineer",
      url: "https://stripe.com/jobs/1?utm=foo",
    });
    expect(result.applied).toBe(true);
    expect(result.reason).toContain("matching URL");
  });

  it("detects reposted jobs with same company and normalized title", () => {
    db.exec(`
      INSERT INTO jobs (id, source_id, source_job_id, company, title, url, first_seen_at, last_seen_at)
      VALUES (1, 's1', '1', 'SingleStore, Inc.', 'Software Engineer Intern - Engine (2026)', 'https://jobs.com/old', 100, 100),
             (2, 's2', '2', 'SingleStore', 'Software Engineer Intern - Engine [Summer 2026]', 'https://jobs.com/new', 200, 200)
    `);
    setStatus(db, 1, "applied", 100);

    const result = isJobAlreadyApplied(db, {
      id: 2,
      company: "SingleStore",
      title: "Software Engineer Intern - Engine [Summer 2026]",
      url: "https://jobs.com/new",
    });
    expect(result.applied).toBe(true);
    expect(result.reason).toContain("reposted role");
  });
});
