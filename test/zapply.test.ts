import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseZapplyMarkdown,
  resolveZapplyDatePosted,
  deriveWorkModel,
} from "../src/sources/zapply.ts";

const fixturePath = join(import.meta.dir, "..", "fixtures", "zapply-sample.md");
const markdown = readFileSync(fixturePath, "utf-8");

// Fixed "now" so date calculations and month-crossing are deterministic.
const NOW = new Date(2026, 7, 14, 12, 0, 0); // Aug 14, 2026, 12:00:00

describe("parseZapplyMarkdown", () => {
  test("parses well-formed rows and skips malformed or linkless ones", async () => {
    const { jobs, skippedRows } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    // In fixture:
    // Table 1: Adobe (ok), ↳ (ok), Microsoft (ok), Stripe (ok), Plain Text Co (ok),
    // Direct Link Corp (ok), Inactive Corp (ok), Malformed row (skipped)
    // Table 2: Waymo (ok), No Link Corp (skipped)
    // -> 2 skipped, 8 parsed
    expect(skippedRows).toBe(2);
    expect(jobs).toHaveLength(8);
  });

  test("↳ carries the previous row's company forward", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const sde = jobs.find((j) => j.title === "Software Development Engineer, 3D Graphics")!;
    expect(sde).toBeDefined();
    expect(sde.company).toBe("Adobe");
  });

  test("extracts the zapply slug as sourceJobId", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const msft = jobs.find((j) => j.company === "Microsoft")!;
    expect(msft.sourceJobId).toBe("microsoft-200041085");
    expect(msft.url).toBe(
      "https://zapply.jobs/l/d/microsoft-200041085?s=gh-internships-2027",
    );
  });

  test("falls back to a stable sha256 hash when the URL lacks a /l/d/ slug", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const direct = jobs.find((j) => j.company === "Direct Link Corp")!;
    expect(direct).toBeDefined();
    expect(direct.sourceJobId).toMatch(/^[0-9a-f]{64}$/);
    expect(direct.url).toBe("https://direct.example.com/apply/fe");
  });

  test("unescapes markdown backslashes in job title", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const stripe = jobs.find((j) => j.company === "Stripe")!;
    expect(stripe.title).toBe("Solutions Engineer [Pre and Post-Sales] - SMB");
  });

  test("extracts company link if present and strips markdown bolding", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const stripe = jobs.find((j) => j.company === "Stripe")!;
    expect(stripe.company).toBe("Stripe");
    expect(stripe.extra?.companyUrl).toBe("https://stripe.com");

    const plain = jobs.find((j) => j.company === "Plain Text Co")!;
    expect(plain.company).toBe("Plain Text Co");
  });

  test("derives work model from location and title", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const stripe = jobs.find((j) => j.company === "Stripe")!;
    expect(stripe.workModel).toBe("remote");

    const plain = jobs.find((j) => j.company === "Plain Text Co")!;
    expect(plain.workModel).toBe("hybrid");
  });

  test("extracts category from details/summary into extra.category", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const adobe = jobs.find((j) => j.company === "Adobe" && j.title.includes("Experience"))!;
    expect(adobe.extra?.category).toBe("Software Engineering");

    const waymo = jobs.find((j) => j.company === "Waymo")!;
    expect(waymo.extra?.category).toBe("Data, AI & Research");
  });

  test("extracts visa / sponsorship info into extra", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const adobe = jobs.find((j) => j.company === "Adobe" && j.title.includes("Experience"))!;
    expect(adobe.extra?.sponsorship).toBe("✅ Sponsor");

    const stripe = jobs.find((j) => j.company === "Stripe")!;
    expect(stripe.extra?.sponsorship).toBeUndefined();
  });

  test("marks closed listings (strikethrough ~~) as active=false", async () => {
    const { jobs } = await parseZapplyMarkdown(
      "zapply-newgrad-2027",
      markdown,
      NOW,
    );
    const closed = jobs.find((j) => j.company === "Inactive Corp")!;
    expect(closed.active).toBe(false);

    const active = jobs.find((j) => j.company === "Microsoft")!;
    expect(active.active).toBe(true);
  });
});

describe("resolveZapplyDatePosted", () => {
  test("resolves relative minutes", () => {
    const d = resolveZapplyDatePosted("14m", NOW)!;
    expect(d.getTime()).toBe(NOW.getTime() - 14 * 60 * 1000);
  });

  test("resolves relative hours", () => {
    const d = resolveZapplyDatePosted("6h", NOW)!;
    expect(d.getTime()).toBe(NOW.getTime() - 6 * 3600 * 1000);
  });

  test("resolves relative days", () => {
    const d = resolveZapplyDatePosted("1d", NOW)!;
    expect(d.getTime()).toBe(NOW.getTime() - 24 * 3600 * 1000);
  });

  test("resolves relative weeks", () => {
    const d = resolveZapplyDatePosted("2w", NOW)!;
    expect(d.getTime()).toBe(NOW.getTime() - 14 * 24 * 3600 * 1000);
  });

  test("resolves standard month and day in the past to current year", () => {
    const d = resolveZapplyDatePosted("Aug 13", NOW)!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(13);
  });

  test("resolves future month/day relative to now to previous year", () => {
    const d = resolveZapplyDatePosted("Dec 25", NOW)!;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11); // December
    expect(d.getDate()).toBe(25);
  });

  test("returns undefined for 'Date unknown' or unparseable text", () => {
    expect(resolveZapplyDatePosted("Date unknown", NOW)).toBeUndefined();
    expect(resolveZapplyDatePosted("unknown", NOW)).toBeUndefined();
    expect(resolveZapplyDatePosted("n/a", NOW)).toBeUndefined();
  });
});

describe("deriveWorkModel", () => {
  test("identifies hybrid before remote when both or combo mentioned", () => {
    expect(deriveWorkModel("New York, NY", "Engineer (Hybrid Schedule)")).toBe("hybrid");
    expect(deriveWorkModel("Hybrid (Remote 2 days)", "Engineer")).toBe("hybrid");
  });

  test("identifies remote from location or title", () => {
    expect(deriveWorkModel("Remote - US", "Engineer")).toBe("remote");
    expect(deriveWorkModel("United States", "Remote Software Engineer")).toBe("remote");
  });

  test("identifies onsite from location or title", () => {
    expect(deriveWorkModel("Austin, TX", "Onsite Developer")).toBe("onsite");
    expect(deriveWorkModel("On-site (San Francisco)", "Developer")).toBe("onsite");
  });

  test("returns undefined when no work model keywords present", () => {
    expect(deriveWorkModel("San Jose, CA", "Software Engineer")).toBeUndefined();
  });
});
