import { describe, expect, test } from "bun:test";
import { parseSimplifyJobs } from "../src/sources/simplify.ts";
import fixture from "../fixtures/simplify-sample.json";

describe("parseSimplifyJobs", () => {
  const jobs = parseSimplifyJobs("simplify-newgrad", fixture as any);

  test("ingests every row, including inactive and non-visible ones", () => {
    expect(jobs).toHaveLength(4);
  });

  test("maps id -> sourceJobId and preserves company/title/url", () => {
    const mechanize = jobs.find((j) => j.company === "Mechanize")!;
    expect(mechanize.sourceJobId).toBe("20fe605e-0000-0000-0000-000000000001");
    expect(mechanize.title).toBe("Software Engineer");
    expect(mechanize.url).toBe("https://jobs.ashbyhq.com/mechanize/swe");
  });

  test("active:false is preserved as active=false, not skipped", () => {
    const dead = jobs.find((j) => j.company === "Dead Startup Inc")!;
    expect(dead).toBeDefined();
    expect(dead.active).toBe(false);
  });

  test("is_visible:false is treated identically to active:false", () => {
    const hidden = jobs.find((j) => j.company === "Hidden Corp")!;
    expect(hidden).toBeDefined();
    expect(hidden.active).toBe(false);
  });

  test("workModel is 'remote' when any location contains 'remote' (case-insensitive)", () => {
    const stripe = jobs.find((j) => j.company === "Stripe")!;
    expect(stripe.workModel).toBe("remote");
    const hidden = jobs.find((j) => j.company === "Hidden Corp")!;
    expect(hidden.workModel).toBe("remote");
  });

  test("workModel is undefined when no location mentions remote (no hybrid/onsite guessing)", () => {
    const mechanize = jobs.find((j) => j.company === "Mechanize")!;
    expect(mechanize.workModel).toBeUndefined();
  });

  test("category is preserved in extra for the cat: filter", () => {
    const dead = jobs.find((j) => j.company === "Dead Startup Inc")!;
    expect(dead.extra?.category).toBe("Product");
  });

  test("datePosted converts unix seconds to a Date", () => {
    const mechanize = jobs.find((j) => j.company === "Mechanize")!;
    expect(mechanize.datePosted?.getTime()).toBe(1767841111 * 1000);
  });
});
