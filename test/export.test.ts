import { describe, expect, test } from "bun:test";
import { exportJobsToCsv, exportJobsToJson, formatFromPath } from "../src/export.ts";
import type { JobRecord } from "../src/db/repo.ts";

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 1,
    sourceId: "simplify-newgrad",
    sourceJobId: "abc",
    company: "Acme",
    title: "Software Engineer",
    url: "https://example.com/apply",
    locations: ["Remote", "NYC"],
    workModel: "remote",
    datePosted: 1000,
    active: true,
    extra: { category: "Software" },
    firstSeenAt: 100,
    lastSeenAt: 200,
    status: "applied",
    notes: null,
    updatedAt: 150,
    ...overrides,
  };
}

describe("formatFromPath", () => {
  test("recognizes .csv and .json extensions", () => {
    expect(formatFromPath("out.csv")).toBe("csv");
    expect(formatFromPath("out.json")).toBe("json");
  });

  test("returns null for an unrecognized extension", () => {
    expect(formatFromPath("out.txt")).toBeNull();
  });
});

describe("exportJobsToJson", () => {
  test("round-trips every job field", () => {
    const jobs = [job()];
    const parsed = JSON.parse(exportJobsToJson(jobs));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].company).toBe("Acme");
    expect(parsed[0].locations).toEqual(["Remote", "NYC"]);
  });
});

describe("exportJobsToCsv", () => {
  test("includes a header row and one data row per job", () => {
    const csv = exportJobsToCsv([job(), job({ id: 2, company: "Beta" })]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toContain("company");
  });

  test("joins multiple locations with a semicolon (comma would break CSV columns)", () => {
    const csv = exportJobsToCsv([job({ locations: ["Remote", "NYC"] })]);
    expect(csv).toContain("Remote; NYC");
  });

  test("escapes commas, quotes, and newlines in notes", () => {
    const csv = exportJobsToCsv([job({ notes: 'has, a "quote"\nand a newline' })]);
    const dataLine = csv.trim().split("\n")[1]!;
    expect(dataLine).toContain('"has, a ""quote""');
  });

  test("null fields render as empty, not the string 'null'", () => {
    const csv = exportJobsToCsv([job({ status: null, notes: null, workModel: null })]);
    expect(csv).not.toContain("null");
  });
});
