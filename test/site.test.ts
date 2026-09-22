import { describe, expect, test } from "bun:test";
import { detectJobSite } from "../src/site.ts";

describe("detectJobSite", () => {
  test("recognizes common ATS hostnames", () => {
    expect(detectJobSite("https://jobs.ashbyhq.com/mechanize/swe").label).toBe("ashby");
    expect(detectJobSite("https://boards.greenhouse.io/acme/jobs/123").label).toBe("greenhouse");
    expect(detectJobSite("https://jobs.lever.co/acme/abc").label).toBe("lever");
    expect(detectJobSite("https://boeing.wd1.myworkdayjobs.com/EXTERNAL/job/x").label).toBe(
      "workday",
    );
    expect(detectJobSite("https://careers-kyocera.icims.com/jobs/3236/job").label).toBe("icims");
    expect(detectJobSite("https://jobright.ai/jobs/info/abc123?utm=1").label).toBe("jobright");
    expect(detectJobSite("https://zapply.jobs/l/d/abc?s=1").label).toBe("zapply");
  });

  test("falls back to the domain segment for an unrecognized host", () => {
    expect(detectJobSite("https://stripe.com/jobs/swe-newgrad").label).toBe("stripe");
  });

  test("returns a placeholder for an unparseable URL", () => {
    expect(detectJobSite("not a url").label).toBe("?");
  });

  test("known ATSes each get a distinct, defined color", () => {
    const sites = [
      "https://jobs.ashbyhq.com/a",
      "https://boards.greenhouse.io/a",
      "https://jobs.lever.co/a",
      "https://a.myworkdayjobs.com/a",
    ].map((u) => detectJobSite(u));
    expect(new Set(sites.map((s) => s.color)).size).toBe(sites.length);
  });
});
