import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseJobrightMarkdown,
  resolveDatePosted,
} from "../src/sources/jobright.ts";

const fixturePath = join(import.meta.dir, "..", "fixtures", "jobright-sample.md");
const markdown = readFileSync(fixturePath, "utf-8");

// Fixed "now" so date resolution and month-crossing are deterministic.
const NOW = new Date(2026, 7, 14); // Aug 14, 2026

describe("parseJobrightMarkdown", () => {
  test("parses well-formed rows and skips the malformed one", async () => {
    const { jobs, skippedRows } = await parseJobrightMarkdown(
      "jobright-swe-2026",
      markdown,
      NOW,
    );
    // 7 data rows in fixture: "No Link Corp" has no markdown link in its
    // title cell (skipped) and the last row is malformed (skipped) -> 2 skipped, 5 parsed.
    expect(skippedRows).toBe(2);
    expect(jobs).toHaveLength(5);
  });

  test("↳ carries the previous row's company forward", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    const swe2 = jobs.find((j) => j.title === "SWE II, New Grad")!;
    expect(swe2).toBeDefined();
    expect(swe2.company).toBe("Google");
  });

  test("extracts the 24-hex jobright id as sourceJobId", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    const google = jobs.find((j) => j.title === "Software Engineer, New Grad")!;
    expect(google.sourceJobId).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  test("a row with no markdown link at all in the title cell is skipped, not hashed", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    const noLink = jobs.find((j) => j.company === "No Link Corp");
    expect(noLink).toBeUndefined();
  });

  test("falls back to a stable sha256 hash when the title link isn't a jobright /info/ URL", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    const odd = jobs.find((j) => j.company === "Odd Redirect Co")!;
    expect(odd).toBeDefined();
    expect(odd.sourceJobId).toMatch(/^[0-9a-f]{64}$/); // sha256 hex digest
    expect(odd.url).toBe("https://oddredirect.com/apply/xyz");

    // Same inputs -> same hash (stability across syncs).
    const { jobs: jobs2 } = await parseJobrightMarkdown(
      "jobright-swe-2026",
      markdown,
      NOW,
    );
    const odd2 = jobs2.find((j) => j.company === "Odd Redirect Co")!;
    expect(odd2.sourceJobId).toBe(odd.sourceJobId);
  });

  test("tolerates a plain-text company cell (no bold/link)", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    const plain = jobs.find((j) => j.company === "Plain Text Co");
    expect(plain).toBeDefined();
    expect(plain?.title).toBe("Backend Engineer");
  });

  test("work model: hybrid checked before remote for combo cells", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    const plain = jobs.find((j) => j.company === "Plain Text Co")!;
    // cell: "Hybrid (Remote days available)" -> should resolve to hybrid, not remote
    expect(plain.workModel).toBe("hybrid");
    const anthropic = jobs.find((j) => j.company === "Anthropic")!;
    // cell: "Hybrid/NYC" -> hybrid
    expect(anthropic.workModel).toBe("hybrid");
  });

  test("work model: plain remote and onsite cells resolve correctly", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    const swe2 = jobs.find((j) => j.title === "SWE II, New Grad")!;
    expect(swe2.workModel).toBe("remote");
    const google = jobs.find((j) => j.title === "Software Engineer, New Grad")!;
    expect(google.workModel).toBe("onsite");
  });

  test("jobright rows are always active=true regardless of README absence rules", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    expect(jobs.every((j) => j.active === true)).toBe(true);
  });

  test("jobright rows have no category in extra (cat: filter excludes them by design)", async () => {
    const { jobs } = await parseJobrightMarkdown("jobright-swe-2026", markdown, NOW);
    expect(jobs.every((j) => (j.extra as any)?.category === undefined)).toBe(true);
  });
});

describe("resolveDatePosted", () => {
  test("resolves to the current year when the month/day is in the past", () => {
    const d = resolveDatePosted("Aug 10", NOW)!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August (0-indexed)
    expect(d.getDate()).toBe(10);
  });

  test("resolves to the previous year when the month/day is in the future relative to now", () => {
    // "now" is Aug 14, 2026 -> "Dec 25" hasn't happened yet this year.
    const d = resolveDatePosted("Dec 25", NOW)!;
    expect(d.getFullYear()).toBe(2025);
  });

  test("returns undefined for an unparseable cell", () => {
    expect(resolveDatePosted("not a date", NOW)).toBeUndefined();
  });
});
