import { describe, expect, test } from "bun:test";
import { formatStatusCounts, formatSyncLabel } from "../src/ui/Header.tsx";
import { STATUS_ORDER, type ApplicationStatus } from "../src/db/repo.ts";

function counts(overrides: Partial<Record<ApplicationStatus, number>>): Record<ApplicationStatus, number> {
  const base = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
    ApplicationStatus,
    number
  >;
  return { ...base, ...overrides };
}

describe("formatStatusCounts", () => {
  test("omits zero-count statuses", () => {
    expect(formatStatusCounts(counts({ applied: 3 }))).toBe("applied:3");
  });

  test("renders multiple in lifecycle order regardless of input order", () => {
    expect(formatStatusCounts(counts({ rejected: 1, applied: 2, saved: 5 }))).toBe(
      "saved:5 · applied:2 · rejected:1",
    );
  });

  test("empty when nothing tracked", () => {
    expect(formatStatusCounts(counts({}))).toBe("");
  });
});

describe("formatSyncLabel", () => {
  const sources = [
    { id: "simplify-newgrad", displayName: "SimplifyJobs New Grad" },
    { id: "jobright-swe-2026", displayName: "jobright SWE New Grad 2026" },
  ];
  const NOW = 2_000_000_000_000;

  test("shows a single aggregate label when all sources are in sync", () => {
    const perSource = {
      "simplify-newgrad": NOW - 60_000,
      "jobright-swe-2026": NOW - 65_000,
    };
    expect(formatSyncLabel(sources, perSource, "idle", NOW)).toBe("synced 1m ago");
  });

  test("shows a per-source breakdown when one source is stale (e.g. errored)", () => {
    const perSource = {
      "simplify-newgrad": NOW - 60_000,
      "jobright-swe-2026": NOW - 5 * 60 * 60 * 1000,
    };
    const label = formatSyncLabel(sources, perSource, "idle", NOW);
    expect(label).toContain("simplify 1m ago");
    expect(label).toContain("jobright 5h ago");
  });

  test("shows 'never' for a source that has never completed a sync", () => {
    const perSource = { "simplify-newgrad": NOW - 60_000 };
    const label = formatSyncLabel(sources, perSource, "idle", NOW);
    expect(label).toContain("jobright never");
  });

  test("returns 'never synced' when nothing has synced yet", () => {
    expect(formatSyncLabel(sources, {}, "idle", NOW)).toBe("never synced");
  });

  test("returns 'syncing…' while a sync is in flight, regardless of prior state", () => {
    const perSource = { "simplify-newgrad": NOW - 60_000 };
    expect(formatSyncLabel(sources, perSource, "syncing", NOW)).toBe("syncing…");
  });
});
