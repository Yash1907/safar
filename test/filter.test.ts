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

describe("OR filtering across tokens and free text", () => {
  test('title:"xyz" OR title:"abc" matches jobs matching either title', () => {
    const jobs = [
      job({ id: 1, title: "Frontend Developer xyz" }),
      job({ id: 2, title: "Backend Developer abc" }),
      job({ id: 3, title: "Data Scientist other" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery('title:"xyz" OR title:"abc"'), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test('title:"xyz" title:"abc" (without OR) requires both in the title (AND)', () => {
    const jobs = [
      job({ id: 1, title: "xyz only" }),
      job({ id: 2, title: "abc only" }),
      job({ id: 3, title: "xyz and abc together" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery('title:"xyz" title:"abc"'), noNew);
    expect(result.map((j) => j.id)).toEqual([3]);
  });

  test("pipe '|' works identically to 'OR'", () => {
    const jobs = [
      job({ id: 1, title: "Developer xyz" }),
      job({ id: 2, title: "Developer abc" }),
      job({ id: 3, title: "Other" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("title:xyz | title:abc"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("lowercase 'or' works as OR operator", () => {
    const jobs = [
      job({ id: 1, company: "Google" }),
      job({ id: 2, company: "Meta" }),
      job({ id: 3, company: "Amazon" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("company:google or company:meta"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("free-text OR matches jobs containing either term across fields", () => {
    const jobs = [
      job({ id: 1, title: "Rust Developer", company: "Acme" }),
      job({ id: 2, title: "Python Developer", company: "Beta" }),
      job({ id: 3, title: "Java Developer", company: "Gamma" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("rust OR python"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("free-text quoted phrases with OR preserve spaces", () => {
    const jobs = [
      job({ id: 1, title: "Machine Learning Engineer" }),
      job({ id: 2, title: "Data Scientist" }),
      job({ id: 3, title: "DevOps Engineer" }),
    ];
    const result = applyFilter(
      jobs,
      parseFilterQuery('"machine learning" OR "data scientist"'),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("combines AND within clauses with OR between clauses", () => {
    const jobs = [
      job({ id: 1, company: "Google", title: "Software Engineer" }),
      job({ id: 2, company: "Google", title: "Product Manager" }),
      job({ id: 3, company: "Apple", title: "Software Engineer" }),
      job({ id: 4, company: "Apple", title: "Designer" }),
    ];
    // (Google AND SWE) OR (Apple AND SWE)
    const result = applyFilter(
      jobs,
      parseFilterQuery("company:google title:software OR company:apple title:software"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([1, 3]);
  });

  test("OR across different fields (e.g. wm:remote OR loc:austin)", () => {
    const jobs = [
      job({ id: 1, workModel: "remote", locations: ["Anywhere"] }),
      job({ id: 2, workModel: "onsite", locations: ["Austin, TX"] }),
      job({ id: 3, workModel: "onsite", locations: ["Seattle, WA"] }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("wm:remote OR loc:austin"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("OR on sites (site:greenhouse OR site:lever)", () => {
    const jobs = [
      job({ id: 1, url: "https://boards.greenhouse.io/acme/1" }),
      job({ id: 2, url: "https://jobs.lever.co/acme/1" }),
      job({ id: 3, url: "https://jobs.ashbyhq.com/acme/1" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("site:greenhouse OR site:lever"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("OR on application statuses (status:applied OR status:oa)", () => {
    const jobs = [
      job({ id: 1, status: "applied" }),
      job({ id: 2, status: "oa" }),
      job({ id: 3, status: "rejected" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("status:applied OR status:oa"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("OR on notes (note:referral OR note:urgent)", () => {
    const jobs = [
      job({ id: 1, notes: "got a referral from Alice" }),
      job({ id: 2, notes: "urgent: deadline tomorrow" }),
      job({ id: 3, notes: "applied on website" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("note:referral OR note:urgent"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("within-token comma OR (e.g. title:software,hardware)", () => {
    const jobs = [
      job({ id: 1, title: "Software Engineer" }),
      job({ id: 2, title: "Hardware Engineer" }),
      job({ id: 3, title: "Product Manager" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("title:software,hardware"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("quoted strings with comma (e.g. company:\"Acme, Inc.\") do not split into alternatives", () => {
    const jobs = [
      job({ id: 1, company: "Acme, Inc." }),
      job({ id: 2, company: "Inc. Corporation" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery('company:"Acme, Inc."'), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("trailing OR while typing does not crash or match everything", () => {
    const jobs = [
      job({ id: 1, title: "Software Engineer" }),
      job({ id: 2, title: "Product Manager" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("title:software OR"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });
});

describe("explicit AND searching across tokens and fields", () => {
  test("company:google AND title:swe matches jobs matching both", () => {
    const jobs = [
      job({ id: 1, company: "Google", title: "SWE" }),
      job({ id: 2, company: "Google", title: "PM" }),
      job({ id: 3, company: "Apple", title: "SWE" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("company:google AND title:swe"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("title:forward,software,technology AND title:\"new grad\"", () => {
    const jobs = [
      job({ id: 1, title: "Software Engineer - New Grad" }),
      job({ id: 2, title: "Forward Deployed Engineer - New Grad" }),
      job({ id: 3, title: "Technology Analyst - New Grad" }),
      job({ id: 4, title: "Software Engineer - Senior" }),
      job({ id: 5, title: "Account Manager - New Grad" }),
    ];
    const q1 = applyFilter(
      jobs,
      parseFilterQuery('title:forward,software,technology AND title:"new grad"'),
      noNew,
    );
    expect(q1.map((j) => j.id)).toEqual([1, 2, 3]);

    const q2 = applyFilter(
      jobs,
      parseFilterQuery('title:forward,software,technology AND title: "new grad"'),
      noNew,
    );
    expect(q2.map((j) => j.id)).toEqual([1, 2, 3]);

    const q3 = applyFilter(
      jobs,
      parseFilterQuery("title:forward,software,technology AND title:(new grad)"),
      noNew,
    );
    expect(q3.map((j) => j.id)).toEqual([1, 2, 3]);

    const q4 = applyFilter(
      jobs,
      parseFilterQuery("title:forward,software,technology AND title: new grad"),
      noNew,
    );
    expect(q4.map((j) => j.id)).toEqual([1, 2, 3]);
  });

  test("lowercase 'and' works as AND operator", () => {
    const jobs = [
      job({ id: 1, company: "Google", title: "SWE" }),
      job({ id: 2, company: "Google", title: "PM" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("company:google and title:swe"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("'&&' works as AND operator", () => {
    const jobs = [
      job({ id: 1, locations: ["Austin"], workModel: "hybrid" }),
      job({ id: 2, locations: ["Austin"], workModel: "remote" }),
      job({ id: 3, locations: ["Seattle"], workModel: "hybrid" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("loc:austin && wm:hybrid"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("combining 3 or more fields with AND", () => {
    const jobs = [
      job({ id: 1, company: "Apple", title: "Software Engineer", locations: ["Remote"] }),
      job({ id: 2, company: "Apple", title: "Hardware Engineer", locations: ["Remote"] }),
      job({ id: 3, company: "Apple", title: "Software Engineer", locations: ["Cupertino"] }),
      job({ id: 4, company: "Google", title: "Software Engineer", locations: ["Remote"] }),
    ];
    const result = applyFilter(
      jobs,
      parseFilterQuery("company:apple AND title:software AND loc:remote"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("free-text AND matches jobs containing both terms", () => {
    const jobs = [
      job({ id: 1, company: "Acme", title: "Rust and Python Developer" }),
      job({ id: 2, company: "Acme", title: "Rust Developer" }),
      job({ id: 3, company: "Acme", title: "Python Developer" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("rust AND python"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("trailing AND while typing does not crash or fail matching", () => {
    const jobs = [
      job({ id: 1, title: "Software Engineer" }),
      job({ id: 2, title: "Product Manager" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("title:software AND"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });
});

describe("NOT searching across all fields", () => {
  test("NOT company: excludes matching company", () => {
    const jobs = [
      job({ id: 1, company: "Google" }),
      job({ id: 2, company: "Microsoft" }),
      job({ id: 3, company: "Apple" }),
    ];
    expect(applyFilter(jobs, parseFilterQuery("NOT company:google"), noNew).map((j) => j.id)).toEqual([2, 3]);
    expect(applyFilter(jobs, parseFilterQuery("-company:google"), noNew).map((j) => j.id)).toEqual([2, 3]);
    expect(applyFilter(jobs, parseFilterQuery("!company:google"), noNew).map((j) => j.id)).toEqual([2, 3]);
    expect(applyFilter(jobs, parseFilterQuery("company:!google"), noNew).map((j) => j.id)).toEqual([2, 3]);
    expect(applyFilter(jobs, parseFilterQuery("company:-google"), noNew).map((j) => j.id)).toEqual([2, 3]);
  });

  test("NOT title: excludes matching title", () => {
    const jobs = [
      job({ id: 1, title: "Junior Software Engineer" }),
      job({ id: 2, title: "Senior Software Engineer" }),
      job({ id: 3, title: "Staff Software Engineer" }),
    ];
    const q1 = applyFilter(jobs, parseFilterQuery("title:software NOT title:senior"), noNew);
    expect(q1.map((j) => j.id)).toEqual([1, 3]);

    const q2 = applyFilter(jobs, parseFilterQuery("title:software -title:senior"), noNew);
    expect(q2.map((j) => j.id)).toEqual([1, 3]);

    const q3 = applyFilter(jobs, parseFilterQuery("title:software title:!senior"), noNew);
    expect(q3.map((j) => j.id)).toEqual([1, 3]);
  });

  test("NOT loc: excludes matching locations", () => {
    const jobs = [
      job({ id: 1, locations: ["Remote"] }),
      job({ id: 2, locations: ["Austin, TX"] }),
      job({ id: 3, locations: ["New York, NY"] }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("NOT loc:new"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);

    const result2 = applyFilter(jobs, parseFilterQuery("-loc:new"), noNew);
    expect(result2.map((j) => j.id)).toEqual([1, 2]);
  });

  test("NOT wm: excludes matching work model", () => {
    const jobs = [
      job({ id: 1, workModel: "remote" }),
      job({ id: 2, workModel: "hybrid" }),
      job({ id: 3, workModel: "onsite" }),
      job({ id: 4, workModel: undefined }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("NOT wm:remote"), noNew);
    expect(result.map((j) => j.id)).toEqual([2, 3, 4]);

    const result2 = applyFilter(jobs, parseFilterQuery("wm:!remote"), noNew);
    expect(result2.map((j) => j.id)).toEqual([2, 3, 4]);
  });

  test("NOT cat: excludes matching category", () => {
    const jobs = [
      job({ id: 1, extra: { category: "Software" } }),
      job({ id: 2, extra: { category: "Hardware" } }),
      job({ id: 3, extra: {} }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("NOT cat:software"), noNew);
    expect(result.map((j) => j.id)).toEqual([2, 3]);
  });

  test("NOT src: excludes matching sourceId", () => {
    const jobs = [
      job({ id: 1, sourceId: "simplify-newgrad" }),
      job({ id: 2, sourceId: "jobright-swe-2026" }),
      job({ id: 3, sourceId: "zapply-2027" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("NOT src:simplify"), noNew);
    expect(result.map((j) => j.id)).toEqual([2, 3]);

    const result2 = applyFilter(jobs, parseFilterQuery("-src:simplify"), noNew);
    expect(result2.map((j) => j.id)).toEqual([2, 3]);
  });

  test("NOT status: excludes rejected jobs while keeping other and untracked jobs", () => {
    const jobs = [
      job({ id: 1, status: "applied" }),
      job({ id: 2, status: "rejected" }),
      job({ id: 3, status: null }), // untracked
    ];
    const result = applyFilter(jobs, parseFilterQuery("NOT status:rejected"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 3]);

    const result2 = applyFilter(jobs, parseFilterQuery("status:!rejected"), noNew);
    expect(result2.map((j) => j.id)).toEqual([1, 3]);
  });

  test("NOT note: excludes jobs with matching notes, keeping null and other notes", () => {
    const jobs = [
      job({ id: 1, notes: "got a referral" }),
      job({ id: 2, notes: "rejected without interview" }),
      job({ id: 3, notes: null }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("NOT note:referral"), noNew);
    expect(result.map((j) => j.id)).toEqual([2, 3]);

    const result2 = applyFilter(jobs, parseFilterQuery("-note:referral"), noNew);
    expect(result2.map((j) => j.id)).toEqual([2, 3]);
  });

  test("NOT site: excludes matching job ATS/site", () => {
    const jobs = [
      job({ id: 1, url: "https://boards.greenhouse.io/acme/1" }),
      job({ id: 2, url: "https://jobs.lever.co/acme/1" }),
      job({ id: 3, url: "https://jobs.ashbyhq.com/acme/1" }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("NOT site:greenhouse"), noNew);
    expect(result.map((j) => j.id)).toEqual([2, 3]);

    const result2 = applyFilter(jobs, parseFilterQuery("-site:greenhouse"), noNew);
    expect(result2.map((j) => j.id)).toEqual([2, 3]);
  });

  test("NOT new: / -new: matches only non-new jobs", () => {
    const isNewFn = (j: JobRecord) => j.id === 1;
    const jobs = [job({ id: 1 }), job({ id: 2 })];

    expect(applyFilter(jobs, parseFilterQuery("NOT new:"), isNewFn).map((j) => j.id)).toEqual([2]);
    expect(applyFilter(jobs, parseFilterQuery("-new:"), isNewFn).map((j) => j.id)).toEqual([2]);
    expect(applyFilter(jobs, parseFilterQuery("new:false"), isNewFn).map((j) => j.id)).toEqual([2]);
  });

  test("free text negation (-word / NOT word / !word)", () => {
    const jobs = [
      job({ id: 1, title: "Senior Software Engineer" }),
      job({ id: 2, title: "Software Engineer" }),
      job({ id: 3, title: "Product Manager" }),
    ];
    const r1 = applyFilter(jobs, parseFilterQuery("software NOT senior"), noNew);
    expect(r1.map((j) => j.id)).toEqual([2]);

    const r2 = applyFilter(jobs, parseFilterQuery("software -senior"), noNew);
    expect(r2.map((j) => j.id)).toEqual([2]);

    const r3 = applyFilter(jobs, parseFilterQuery("software !senior"), noNew);
    expect(r3.map((j) => j.id)).toEqual([2]);

    const r4 = applyFilter(jobs, parseFilterQuery("-senior"), noNew);
    expect(r4.map((j) => j.id)).toEqual([2, 3]);
  });

  test("trailing NOT while typing does not crash", () => {
    const jobs = [job({ id: 1, title: "Software Engineer" }), job({ id: 2, title: "PM" })];
    const result = applyFilter(jobs, parseFilterQuery("title:software NOT"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("double negation works", () => {
    const jobs = [job({ id: 1, company: "Google" }), job({ id: 2, company: "Apple" })];
    const result = applyFilter(jobs, parseFilterQuery("NOT NOT company:google"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });
});

describe("complex Boolean expressions with parentheses and operator precedence", () => {
  test("(company:google OR company:meta) AND title:swe", () => {
    const jobs = [
      job({ id: 1, company: "Google", title: "SWE" }),
      job({ id: 2, company: "Google", title: "PM" }),
      job({ id: 3, company: "Meta", title: "SWE" }),
      job({ id: 4, company: "Meta", title: "PM" }),
      job({ id: 5, company: "Amazon", title: "SWE" }),
    ];
    const result = applyFilter(
      jobs,
      parseFilterQuery("(company:google OR company:meta) AND title:swe"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([1, 3]);
  });

  test("implicit AND between parenthesized groups and terms", () => {
    const jobs = [
      job({ id: 1, company: "Google", title: "SWE" }),
      job({ id: 2, company: "Google", title: "PM" }),
      job({ id: 3, company: "Apple", title: "SWE" }),
    ];
    const result = applyFilter(
      jobs,
      parseFilterQuery("(company:google OR company:apple) title:swe"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([1, 3]);
  });

  test("operator precedence: AND has higher precedence than OR", () => {
    const jobs = [
      job({ id: 1, company: "Google", title: "SWE" }),
      job({ id: 2, company: "Apple", title: "SWE" }),
      job({ id: 3, company: "Apple", title: "Designer" }),
      job({ id: 4, company: "Amazon", title: "SWE" }),
    ];
    // "company:google OR company:apple title:swe" -> company:google OR (company:apple AND title:swe)
    const result = applyFilter(
      jobs,
      parseFilterQuery("company:google OR company:apple title:swe"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("parentheses override default precedence", () => {
    const jobs = [
      job({ id: 1, company: "Google", title: "SWE" }),
      job({ id: 2, company: "Google", title: "Designer" }),
      job({ id: 3, company: "Apple", title: "SWE" }),
      job({ id: 4, company: "Apple", title: "Designer" }),
    ];
    // "(company:google OR company:apple) AND title:designer"
    const result = applyFilter(
      jobs,
      parseFilterQuery("(company:google OR company:apple) AND title:designer"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([2, 4]);
  });

  test("negated parenthesized expression: NOT (A OR B)", () => {
    const jobs = [
      job({ id: 1, company: "Google" }),
      job({ id: 2, company: "Meta" }),
      job({ id: 3, company: "Apple" }),
    ];
    const result = applyFilter(
      jobs,
      parseFilterQuery("NOT (company:google OR company:meta)"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([3]);

    const result2 = applyFilter(
      jobs,
      parseFilterQuery("-(company:google OR company:meta)"),
      noNew,
    );
    expect(result2.map((j) => j.id)).toEqual([3]);
  });

  test("complex combination with AND, OR, NOT and parentheses", () => {
    const jobs = [
      job({ id: 1, title: "Software Engineer", locations: ["Remote"], company: "Google" }),
      job({ id: 2, title: "Software Developer", locations: ["Austin, TX"], company: "Apple" }),
      job({ id: 3, title: "Software Engineer", locations: ["New York, NY"], company: "Google" }),
      job({ id: 4, title: "Software Engineer", locations: ["Remote"], company: "Meta" }),
      job({ id: 5, title: "Product Manager", locations: ["Remote"], company: "Google" }),
    ];
    // (title:engineer OR title:developer) AND (loc:remote OR loc:austin) AND NOT company:meta
    const query =
      "(title:engineer OR title:developer) AND (loc:remote OR loc:austin) AND NOT company:meta";
    const result = applyFilter(jobs, parseFilterQuery(query), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("unclosed opening parenthesis while typing does not crash", () => {
    const jobs = [job({ id: 1, title: "Software Engineer" }), job({ id: 2, title: "PM" })];
    const result = applyFilter(jobs, parseFilterQuery("(title:software"), noNew);
    expect(result.map((j) => j.id)).toEqual([1]);
  });
});

describe("field-scoped parentheses", () => {
  test("title:(engineer OR developer) expands field to each alternative", () => {
    const jobs = [
      job({ id: 1, title: "Software Engineer" }),
      job({ id: 2, title: "Web Developer" }),
      job({ id: 3, title: "Product Manager" }),
    ];
    const result = applyFilter(
      jobs,
      parseFilterQuery("title:(engineer OR developer)"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("title:(software AND NOT senior)", () => {
    const jobs = [
      job({ id: 1, title: "Software Engineer" }),
      job({ id: 2, title: "Senior Software Engineer" }),
      job({ id: 3, title: "Product Manager" }),
    ];
    const result = applyFilter(
      jobs,
      parseFilterQuery("title:(software AND NOT senior)"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([1]);
  });

  test("loc:(remote OR austin)", () => {
    const jobs = [
      job({ id: 1, locations: ["Remote"] }),
      job({ id: 2, locations: ["Austin, TX"] }),
      job({ id: 3, locations: ["Seattle, WA"] }),
    ];
    const result = applyFilter(jobs, parseFilterQuery("loc:(remote OR austin)"), noNew);
    expect(result.map((j) => j.id)).toEqual([1, 2]);
  });

  test("-title:(manager OR director) negates the entire scoped group", () => {
    const jobs = [
      job({ id: 1, title: "Engineering Manager" }),
      job({ id: 2, title: "Director of Engineering" }),
      job({ id: 3, title: "Software Engineer" }),
    ];
    const result = applyFilter(
      jobs,
      parseFilterQuery("-title:(manager OR director)"),
      noNew,
    );
    expect(result.map((j) => j.id)).toEqual([3]);
  });
});


