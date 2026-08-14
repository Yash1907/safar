import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export interface RepoSourceConfig {
  id: string;
  displayName: string;
  owner: string;
  repo: string;
  branch?: string;
  enabled?: boolean; // default true
}

export interface SheetsConfig {
  enabled: boolean;
  spreadsheetId: string;
  sheetName: string;
  serviceAccountKeyPath: string;
}

export interface SafarConfig {
  sources: {
    simplify: RepoSourceConfig[];
    jobright: RepoSourceConfig[];
  };
  /** One-way push of tracked jobs to Google Sheets (§ "sync ... with google sheets"). null = not configured. */
  sheets: SheetsConfig | null;
}

/**
 * §5 M4: defaults match §1 — SimplifyJobs New-Grad-Positions always on,
 * Summer2026-Internships available but off by default ("optionally" — §1.1),
 * jobright's 2026 SWE New Grad repo on by default. Adding another jobright
 * (or Simplify) repo is a config entry here, not code (§1.2).
 */
export function defaultConfig(): SafarConfig {
  return {
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
        {
          id: "simplify-summer2026",
          displayName: "SimplifyJobs Summer Internships 2026",
          owner: "SimplifyJobs",
          repo: "Summer2026-Internships",
          branch: "dev",
          enabled: false,
        },
      ],
      jobright: [
        {
          id: "jobright-swe-2026",
          displayName: "jobright SWE New Grad 2026",
          owner: "jobright-ai",
          repo: "2026-Software-Engineer-New-Grad",
          branch: "master",
          enabled: true,
        },
      ],
    },
    sheets: null,
  };
}

export function resolveConfigPath(): string {
  return join(homedir(), ".config", "safar", "config.json");
}

function parseSheetsConfig(raw: unknown): SheetsConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.spreadsheetId !== "string" || typeof r.serviceAccountKeyPath !== "string") {
    return null;
  }
  return {
    enabled: r.enabled !== false,
    spreadsheetId: r.spreadsheetId,
    sheetName: typeof r.sheetName === "string" ? r.sheetName : "Tracker",
    serviceAccountKeyPath: r.serviceAccountKeyPath,
  };
}

/**
 * Loads ~/.config/safar/config.json. Missing file → defaults, silently.
 * Malformed file → defaults, with a warning (defensive parsing, same
 * philosophy as the jobright adapter — a bad config shouldn't crash the app).
 */
export function loadConfig(path: string = resolveConfigPath()): SafarConfig {
  if (!existsSync(path)) return defaultConfig();

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    const defaults = defaultConfig();
    return {
      sources: {
        simplify: Array.isArray(parsed?.sources?.simplify)
          ? parsed.sources.simplify
          : defaults.sources.simplify,
        jobright: Array.isArray(parsed?.sources?.jobright)
          ? parsed.sources.jobright
          : defaults.sources.jobright,
      },
      sheets: parseSheetsConfig(parsed?.sheets),
    };
  } catch (err) {
    console.warn(
      `safar: couldn't parse ${path} (${err instanceof Error ? err.message : err}) — using defaults`,
    );
    return defaultConfig();
  }
}
