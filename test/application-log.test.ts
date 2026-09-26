import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrate } from "../src/db/schema.ts";
import { getStatusHistory, listTrackedJobs, recordSkippedJob } from "../src/db/repo.ts";
import { isJobAlreadyApplied } from "../src/dedup.ts";
import { persistSuccessfulApplication } from "../src/applier/engine.ts";

describe("confirmed application persistence and logging", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    }
  });

  it("updates the database, clears skipped state, deduplicates future runs, and records every field", () => {
    const db = new Database(":memory:");
    migrate(db);
    db.exec(`
      INSERT INTO jobs
        (id, source_id, source_job_id, company, title, url, first_seen_at, last_seen_at, active)
      VALUES
        (7, 'fixture', 'job-7', 'Acme Corp', 'Software Engineer',
         'https://boards.greenhouse.io/acme/jobs/7', 1000, 1000, 1)
    `);
    recordSkippedJob(db, 7, "Earlier failure", 1100);

    const directory = mkdtempSync(join(tmpdir(), "safar-app-log-"));
    temporaryDirectories.push(directory);
    const logPath = join(directory, "log.txt");

    const result = persistSuccessfulApplication(
      db,
      {
        id: 7,
        company: "Acme Corp",
        title: "Software Engineer",
        url: "https://boards.greenhouse.io/acme/jobs/7",
      },
      "greenhouse",
      [
        { label: "First Name", value: "Jane", required: true, category: "CONTACT_FIRST_NAME" },
        { label: "School", value: "UC Berkeley", mustFill: true, category: "EDU_SCHOOL" },
      ],
      1_800_000_000,
      logPath,
    );

    expect(result.warning).toBeUndefined();
    expect(result.logPath).toBe(logPath);
    expect(listTrackedJobs(db).find((job) => job.id === 7)?.status).toBe("applied");
    expect(getStatusHistory(db, 7).at(-1)?.status).toBe("applied");
    expect(isJobAlreadyApplied(db, { id: 7, company: "Acme Corp", title: "Software Engineer", url: "https://boards.greenhouse.io/acme/jobs/7" } as any).applied).toBe(true);

    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("Acme Corp");
    expect(log).toContain("https://boards.greenhouse.io/acme/jobs/7");
    expect(log).toContain("First Name (required, CONTACT_FIRST_NAME): Jane");
    expect(log).toContain("School (required, EDU_SCHOOL): UC Berkeley");
    db.close();
  });
});
