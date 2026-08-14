import { describe, expect, test } from "bun:test";
import { parseFilterQuery, applyFilter } from "../src/filter.ts";
import type { JobRecord } from "../src/db/repo.ts";

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 1,
    sourceId: "simplify-newgrad",
    sourceJobId: "1",
    company: "Acme",
    title: "Software Engineer",
    url: "https://example.com",
    locations: ["Remote"],
    workModel: "remote",
    datePosted: 1000,
    active: true,
    extra: {},
    firstSeenAt: 100,
    lastSeenAt: 100,
    status: null,
    notes: null,
    updatedAt: null,
    ...overrides,
  };
}

const noNew = () => false;

describe("note: filter token and free-text notes search", () => {
  test("note:<text> matches a substring of the job's notes", () => {
    const jobs = [
      job({ id: 1, notes: "Recruiter mentioned a relocation bonus" }),
      job({ id: 2, notes: "Waiting to hear back" }),
    ];
    const parsed = parseFilterQuery("note:relocation");
    const result = applyFilter(jobs, parsed, noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("note: is case-insensitive", () => {
    const jobs = [job({ id: 1, notes: "RELOCATION bonus mentioned" })];
    const result = applyFilter(jobs, parseFilterQuery("note:relocation"), noNew);
    expect(result).toHaveLength(1);
  });

  test("free text (no token) also searches notes, not just company/title/location", () => {
    const jobs = [
      job({ id: 1, company: "Acme", notes: "great culture fit" }),
      job({ id: 2, company: "Beta", notes: null }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("culture"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("a job with no notes doesn't match note: (never throws on null)", () => {
    const jobs = [job({ id: 1, notes: null })];
    const result = applyFilter(jobs, parseFilterQuery("note:anything"), noNew);
    expect(result).toHaveLength(0);
  });
});

describe("site: filter token and free-text site search", () => {
  test("site:<text> matches the detected ATS/job-board", () => {
    const jobs = [
      job({ id: 1, url: "https://boards.greenhouse.io/acme/jobs/1" }),
      job({ id: 2, url: "https://jobs.lever.co/acme/abc" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("site:greenhouse"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("site: is case-insensitive", () => {
    const jobs = [job({ id: 1, url: "https://boards.greenhouse.io/acme/jobs/1" })];
    const result = applyFilter(jobs, parseFilterQuery("site:GREENHOUSE"), noNew);
    expect(result).toHaveLength(1);
  });

  test("free text (no token) also matches company, title, location, AND site", () => {
    const jobs = [
      job({ id: 1, company: "Acme", url: "https://boards.greenhouse.io/acme/jobs/1" }),
      job({ id: 2, company: "Beta", url: "https://jobs.lever.co/beta/1" }),
    ];
    // "greenhouse" doesn't appear in company/title/location — only site.
    const result = applyFilter(jobs, parseFilterQuery("greenhouse"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("free text still matches across title, company, and location as before", () => {
    const jobs = [
      job({ id: 1, company: "Acme", title: "Backend Engineer", locations: ["Austin, TX"] }),
      job({ id: 2, company: "Beta", title: "Frontend Engineer", locations: ["Remote"] }),
    ];
    expect(applyFilter(jobs, parseFilterQuery("acme"), noNew).map((j) => j.id)).toEqual([1]);
    expect(applyFilter(jobs, parseFilterQuery("frontend"), noNew).map((j) => j.id)).toEqual([2]);
    expect(applyFilter(jobs, parseFilterQuery("austin"), noNew).map((j) => j.id)).toEqual([1]);
  });
});

describe("company:/title: tokens and combining multiple column filters at once", () => {
  test("company:<text> matches only the company column", () => {
    const jobs = [job({ id: 1, company: "Microsoft" }), job({ id: 2, company: "Apple" })];
    const result = applyFilter(jobs, parseFilterQuery("company:microsoft"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("title:<text> matches only the title column", () => {
    const jobs = [
      job({ id: 1, title: "Software Engineer" }),
      job({ id: 2, title: "Hardware Engineer" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("title:software"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("company: doesn't accidentally match a word that only appears in the title", () => {
    // "software" appears in the title, not the company — company:software must not match it.
    const jobs = [job({ id: 1, company: "Acme", title: "Software Engineer" })];
    expect(applyFilter(jobs, parseFilterQuery("company:software"), noNew)).toHaveLength(0);
  });

  test("combining company:, title:, loc:, and site: in one query ANDs all four, each optional", () => {
    const jobs = [
      job({
        id: 1,
        company: "Microsoft",
        title: "Software Engineer",
        locations: ["New York, NYC"],
        url: "https://boards.greenhouse.io/microsoft/jobs/1",
      }),
      // fails company
      job({
        id: 2,
        company: "Apple",
        title: "Software Engineer",
        locations: ["New York, NYC"],
        url: "https://boards.greenhouse.io/apple/jobs/1",
      }),
      // fails title
      job({
        id: 3,
        company: "Microsoft",
        title: "Hardware Engineer",
        locations: ["New York, NYC"],
        url: "https://boards.greenhouse.io/microsoft/jobs/2",
      }),
      // fails location
      job({
        id: 4,
        company: "Microsoft",
        title: "Software Engineer",
        locations: ["Seattle, WA"],
        url: "https://boards.greenhouse.io/microsoft/jobs/3",
      }),
      // fails site
      job({
        id: 5,
        company: "Microsoft",
        title: "Software Engineer",
        locations: ["New York, NYC"],
        url: "https://jobs.lever.co/microsoft/1",
      }),
    ];

    const parsed = parseFilterQuery("company:microsoft title:software loc:nyc site:greenhouse");
    expect(applyFilter(jobs, parsed, noNew).map((j) => j.id)).toEqual([1]);
  });

  test("any subset of the tokens can be used alone — none are required together", () => {
    const jobs = [
      job({ id: 1, company: "Microsoft", title: "Software Engineer", locations: ["NYC"] }),
      job({ id: 2, company: "Apple", title: "Hardware Engineer", locations: ["Austin"] }),
    ];
    // Only company: — no title:/loc:/site: at all.
    expect(
      applyFilter(jobs, parseFilterQuery("company:microsoft"), noNew).map((j) => j.id),
    ).toEqual([1]);
    // Only title: + loc: together, no company:/site:.
    expect(
      applyFilter(jobs, parseFilterQuery("title:hardware loc:austin"), noNew).map((j) => j.id),
    ).toEqual([2]);
  });
});
