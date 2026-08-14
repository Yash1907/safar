import { describe, expect, test } from "bun:test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, defaultConfig } from "../src/config.ts";
import { buildSources } from "../src/sources/registry.ts";

function tmpConfigPath(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "safar-config-test-"));
  const path = join(dir, "config.json");
  writeFileSync(path, contents);
  return path;
}

describe("loadConfig", () => {
  test("missing file falls back to defaults", () => {
    const config = loadConfig("/nonexistent/path/config.json");
    expect(config).toEqual(defaultConfig());
  });

  test("malformed JSON falls back to defaults instead of throwing", () => {
    const path = tmpConfigPath("{ not valid json");
    const config = loadConfig(path);
    expect(config).toEqual(defaultConfig());
  });

  test("valid config overrides defaults", () => {
    const path = tmpConfigPath(
      JSON.stringify({
        sources: {
          simplify: [
            {
              id: "simplify-newgrad",
              displayName: "SimplifyJobs New Grad",
              owner: "SimplifyJobs",
              repo: "New-Grad-Positions",
              branch: "dev",
              enabled: true,
            },
          ],
          jobright: [
            {
              id: "jobright-data-2026",
              displayName: "jobright Data Analysis New Grad 2026",
              owner: "jobright-ai",
              repo: "2026-Data-Analysis-New-Grad",
              branch: "master",
              enabled: true,
            },
          ],
        },
      }),
    );
    const config = loadConfig(path);
    expect(config.sources.jobright).toHaveLength(1);
    expect(config.sources.jobright[0]!.id).toBe("jobright-data-2026");
  });

  test("defaults have sheets: null when unconfigured", () => {
    expect(defaultConfig().sheets).toBeNull();
  });

  test("parses a valid sheets section", () => {
    const path = tmpConfigPath(
      JSON.stringify({
        sheets: {
          enabled: true,
          spreadsheetId: "abc123",
          sheetName: "Tracker",
          serviceAccountKeyPath: "~/.config/safar/key.json",
        },
      }),
    );
    const config = loadConfig(path);
    expect(config.sheets).toEqual({
      enabled: true,
      spreadsheetId: "abc123",
      sheetName: "Tracker",
      serviceAccountKeyPath: "~/.config/safar/key.json",
    });
  });

  test("sheetName defaults to 'Tracker' when omitted", () => {
    const path = tmpConfigPath(
      JSON.stringify({
        sheets: { spreadsheetId: "abc123", serviceAccountKeyPath: "~/key.json" },
      }),
    );
    expect(loadConfig(path).sheets?.sheetName).toBe("Tracker");
  });

  test("a sheets section missing required fields is treated as unconfigured (null), not a crash", () => {
    const path = tmpConfigPath(JSON.stringify({ sheets: { enabled: true } }));
    expect(loadConfig(path).sheets).toBeNull();
  });
});

describe("buildSources", () => {
  test("skips entries with enabled:false", () => {
    const config = defaultConfig();
    // simplify-summer2026 is disabled by default (§1.1 "optionally").
    const sources = buildSources(config);
    expect(sources.map((s) => s.id)).not.toContain("simplify-summer2026");
    expect(sources.map((s) => s.id)).toContain("simplify-newgrad");
    expect(sources.map((s) => s.id)).toContain("jobright-swe-2026");
  });

  test("adding a jobright repo is config-only — no code change needed", () => {
    const config = defaultConfig();
    config.sources.jobright.push({
      id: "jobright-data-2026",
      displayName: "jobright Data Analysis New Grad 2026",
      owner: "jobright-ai",
      repo: "2026-Data-Analysis-New-Grad",
      branch: "master",
      enabled: true,
    });
    const sources = buildSources(config);
    expect(sources.map((s) => s.id)).toContain("jobright-data-2026");
  });
});
