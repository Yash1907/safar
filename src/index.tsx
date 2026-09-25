import React from "react";
import { render } from "ink";
import { writeFileSync } from "node:fs";
import { openDb, resolveDbPath, listJobs, listTrackedJobs } from "./db/repo.ts";
import { defaultSources } from "./sources/registry.ts";
import { syncAll, formatSyncSummary } from "./sync.ts";
import { exportJobsToCsv, exportJobsToJson, formatFromPath } from "./export.ts";
import { loadConfig, resolveConfigPath } from "./config.ts";
import { loadServiceAccountKey, getAccessToken } from "./google-auth.ts";
import { pushTrackedJobsToSheet, pullTrackedJobsFromSheet, SPREADSHEETS_SCOPE } from "./sheets.ts";
import { App } from "./app.tsx";

import { runAutoApplyBatch } from "./applier/engine.ts";
import { sendEndOfDayReport } from "./discord.ts";
import { detectPlatform } from "./classifier.ts";
import { listApplicationsForDay } from "./db/repo.ts";
import { detectRoleType, type RoleType } from "./role.ts";

interface Args {
  sync: boolean;
  autoApply: boolean;
  dryRun: boolean;
  headed?: boolean;
  days?: number;
  limit?: number;
  role?: RoleType | "all";
  filter?: string;
  eodReport: boolean;
  scheduler: boolean;
  db?: string;
  config?: string;
  export?: string;
  sheetsSync: boolean;
  sheetsPull: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    sync: false,
    autoApply: false,
    dryRun: false,
    headed: false,
    eodReport: false,
    scheduler: false,
    sheetsSync: false,
    sheetsPull: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sync") {
      args.sync = true;
    } else if (arg === "--auto-apply") {
      args.autoApply = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--headed" || arg === "--no-headless") {
      args.headed = true;
    } else if (arg === "--days") {
      args.days = Number(argv[++i]);
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (arg === "--role") {
      const val = argv[++i]?.toLowerCase();
      if (val === "intern") args.role = "intern";
      else if (val === "ft" || val === "fulltime" || val === "full-time") args.role = "fulltime";
      else if (val === "all") args.role = "all";
    } else if (arg === "--filter" || arg === "-f") {
      args.filter = argv[++i];
    } else if (arg === "--eod-report") {
      args.eodReport = true;
    } else if (arg === "--scheduler") {
      args.scheduler = true;
    } else if (arg === "--db") {
      args.db = argv[++i];
    } else if (arg === "--config") {
      args.config = argv[++i];
    } else if (arg === "--export") {
      args.export = argv[++i];
    } else if (arg === "--sheets-sync") {
      args.sheetsSync = true;
    } else if (arg === "--sheets-pull") {
      args.sheetsPull = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

async function runSheetsSync(db: ReturnType<typeof openDb>): Promise<boolean> {
  const config = loadConfig().sheets;
  if (!config) {
    console.error(
      `safar: --sheets-sync requires a "sheets" section in ${resolveConfigPath()} (see config.example.json)`,
    );
    return true; // hadError
  }
  if (!config.enabled) {
    console.log("safar: sheets sync is disabled in config (sheets.enabled = false) — skipping");
    return false;
  }
  try {
    const key = loadServiceAccountKey(config.serviceAccountKeyPath);
    const token = await getAccessToken(key, SPREADSHEETS_SCOPE);
    const jobs = listTrackedJobs(db);
    const { rowCount } = await pushTrackedJobsToSheet(
      token,
      config.spreadsheetId,
      config.sheetName,
      jobs,
    );
    console.log(`safar: pushed ${rowCount} tracked jobs to Google Sheets ("${config.sheetName}")`);
    return false;
  } catch (err) {
    console.error(`safar: sheets sync failed — ${err instanceof Error ? err.message : err}`);
    return true;
  }
}

async function runSheetsPull(db: ReturnType<typeof openDb>): Promise<boolean> {
  const config = loadConfig().sheets;
  if (!config) {
    console.error(
      `safar: --sheets-pull requires a "sheets" section in ${resolveConfigPath()} (see config.example.json)`,
    );
    return true; // hadError
  }
  if (!config.enabled) {
    console.log("safar: sheets pull is disabled in config (sheets.enabled = false) — skipping");
    return false;
  }
  try {
    const key = loadServiceAccountKey(config.serviceAccountKeyPath);
    const token = await getAccessToken(key, SPREADSHEETS_SCOPE);
    const { pulledCount, untrackedCount } = await pullTrackedJobsFromSheet(
      token,
      config.spreadsheetId,
      config.sheetName,
      db,
    );
    const untrackedPart = untrackedCount > 0 ? ` (${untrackedCount} untracked)` : "";
    console.log(
      `safar: pulled ${pulledCount} tracked jobs from Google Sheets ("${config.sheetName}")${untrackedPart}`,
    );
    return false;
  } catch (err) {
    console.error(`safar: sheets pull failed — ${err instanceof Error ? err.message : err}`);
    return true;
  }
}

async function runAutoApplyCli(
  db: ReturnType<typeof openDb>,
  options: {
    lookbackDays: number;
    dryRun: boolean;
    headed?: boolean;
    limit?: number;
    role?: RoleType | "all";
    filter?: string;
  },
): Promise<boolean> {
  const config = loadConfig();
  if (!config.profile) {
    console.warn(
      `safar: warning — "profile" is not configured in ${resolveConfigPath()}. Auto-applier will identify and classify default jobs, but cannot submit without applicant details (see config.example.json).`,
    );
  }

  const effectiveFilter = options.filter ?? config.autoApply?.filter;
  const filterDesc = effectiveFilter ? ` [filter: "${effectiveFilter}"]` : "";
  const roleDesc = options.role && options.role !== "all" ? ` [${options.role.toUpperCase()}]` : "";
  const modeDesc = options.headed ? "headed (visible browser)" : "headless";
  console.log(
    `safar: starting ${modeDesc} auto-applier${roleDesc}${filterDesc} (lookback: ${options.lookbackDays} days, dry-run: ${options.dryRun})`,
  );
  const result = await runAutoApplyBatch(db, {
    lookbackDays: options.lookbackDays,
    dryRun: options.dryRun,
    headless: options.headed ? false : undefined,
    limit: options.limit,
    role: options.role,
    filter: options.filter,
    onProgress: (msg) => console.log(`[auto-apply] ${msg}`),
  });

  console.log("\n--- Auto-Apply Summary ---");
  console.log(`Total scanned (past ${options.lookbackDays} days): ${result.totalScanned}`);
  console.log(`Successfully applied: ${result.appliedCount}`);
  console.log(`Already applied / Reposts: ${result.alreadyAppliedCount}`);
  console.log(`Skipped (not eligible / custom questions): ${result.skippedCount}`);

  if (result.appliedCount > 0) {
    console.log("\nApplied Jobs:");
    for (const r of result.results.filter((r) => r.status === "applied")) {
      const rBadge = r.roleType ? ` [${r.roleType.toUpperCase()}]` : "";
      console.log(`  ✓ ${r.company} — ${r.title}${rBadge} (${r.url})`);
    }
  }

  return false;
}

async function runEodReportCli(db: ReturnType<typeof openDb>): Promise<boolean> {
  const config = loadConfig();
  const webhookUrl = config.discord?.webhookUrl;
  if (!webhookUrl) {
    console.error(
      `safar: --eod-report requires a "discord.webhookUrl" in ${resolveConfigPath()} (see config.example.json)`,
    );
    return true;
  }

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const dayStartSec = Math.floor(startOfDay.getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  const dateStr = now.toISOString().slice(0, 10);

  const apps = listApplicationsForDay(db, dayStartSec, nowSec);
  const appsWithPlatform = apps.map((app) => ({
    company: app.company,
    title: app.title,
    url: app.url,
    platform: detectPlatform(app.url),
    roleType: detectRoleType(app),
    appliedAt: app.updatedAt || nowSec,
  }));

  console.log(
    `safar: sending end-of-day summary to Discord for ${dateStr} (${apps.length} applications)...`,
  );
  const res = await sendEndOfDayReport(webhookUrl, {
    date: dateStr,
    applications: appsWithPlatform,
  });

  if (!res.success) {
    console.error(`safar: Discord webhook failed — ${res.error}`);
    return true;
  }

  console.log(
    `safar: successfully sent EOD report to Discord webhook! (${apps.length} applications reported)`,
  );
  return false;
}

async function runSchedulerCli(
  db: ReturnType<typeof openDb>,
  options: { filter?: string } = {},
): Promise<boolean> {
  console.log("safar: background scheduler started. Monitoring applications and daily Discord reports...");
  const config = loadConfig();
  const summaryTime = config.discord?.eodSummaryTime || "18:00";
  const [targetHour, targetMinute] = summaryTime.split(":").map(Number);

  let lastReportedDay = "";

  // Run initial auto-apply
  await runAutoApplyCli(db, { lookbackDays: 3, dryRun: false, filter: options.filter });

  // Hourly check loop
  const interval = setInterval(async () => {
    const now = new Date();
    const currentDay = now.toISOString().slice(0, 10);
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    if (
      currentHour === targetHour &&
      Math.abs(currentMinute - (targetMinute || 0)) < 15 &&
      lastReportedDay !== currentDay
    ) {
      console.log(`safar: trigger time reached (${summaryTime}). Sending end-of-day report to Discord...`);
      await runEodReportCli(db);
      lastReportedDay = currentDay;
    }

    try {
      console.log("safar [scheduler]: syncing sources...");
      await syncAll(db, defaultSources());
      await runAutoApplyCli(db, { lookbackDays: 3, dryRun: false, filter: options.filter });
    } catch (err) {
      console.error("safar [scheduler] error:", err);
    }
  }, 60 * 60 * 1000);

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      clearInterval(interval);
      resolve();
    });
    process.on("SIGTERM", () => {
      clearInterval(interval);
      resolve();
    });
  });

  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.config) {
    process.env.SAFAR_CONFIG = args.config;
  }

  if (args.help) {
    console.log(`safar — terminal job aggregator & application tracker

Usage:
  safar [options]

Options:
  --sync           Fetch latest jobs from all configured sources
  --auto-apply     Auto-apply to default Greenhouse & Ashby jobs (past 3 days)
  --dry-run        Test form filling without submitting
  --headed         Run with visible browser window (watch form filling live)
  --days <N>       Lookback days for auto-apply (default: 3)
  --limit <N>      Maximum jobs to auto-apply to
  --role <type>    Filter auto-apply by role: intern, ft, or all (default: all)
  --filter <query> Filter auto-apply jobs by search query (e.g. 'title:forward,software,technology')
  --eod-report     Send end-of-day summary report to Discord webhook
  --scheduler      Run automated background scheduler for auto-apply & daily check
  --export <path>  Export all jobs to .csv or .json
  --sheets-sync    Push tracked jobs to Google Sheets
  --sheets-pull    Pull tracked jobs from Google Sheets
  --db <path>      Custom SQLite database path (default: ${resolveDbPath()})
  --config <path>  Custom config path (default: ${resolveConfigPath()})
  --help, -h       Show this help message`);
    process.exit(0);
  }

  const dbPath = args.db ?? resolveDbPath();
  const db = openDb(dbPath);

  // Headless mode
  if (
    args.sync ||
    args.export ||
    args.sheetsSync ||
    args.sheetsPull ||
    args.autoApply ||
    args.eodReport ||
    args.scheduler
  ) {
    let hadError = false;

    if (args.sync) {
      const results = await syncAll(db, defaultSources());
      console.log(formatSyncSummary(results));
      hadError = results.some((r) => r.error) || hadError;
    }

    if (args.autoApply) {
      hadError =
        (await runAutoApplyCli(db, {
          lookbackDays: args.days ?? 3,
          dryRun: args.dryRun,
          headed: args.headed,
          limit: args.limit,
          role: args.role,
          filter: args.filter,
        })) || hadError;
    }

    if (args.eodReport) {
      hadError = (await runEodReportCli(db)) || hadError;
    }

    if (args.scheduler) {
      hadError = (await runSchedulerCli(db, { filter: args.filter })) || hadError;
    }

    if (args.sheetsPull) {
      hadError = (await runSheetsPull(db)) || hadError;
    }

    if (args.export) {
      const format = formatFromPath(args.export);
      if (!format) {
        console.error(`safar: --export path must end in .csv or .json (got "${args.export}")`);
        process.exit(1);
      }
      const jobs = listJobs(db, { active: "any" });
      const contents = format === "csv" ? exportJobsToCsv(jobs) : exportJobsToJson(jobs);
      writeFileSync(args.export, contents);
      console.log(`safar: exported ${jobs.length} jobs to ${args.export}`);
    }

    if (args.sheetsSync) {
      hadError = (await runSheetsSync(db)) || hadError;
    }

    process.exit(hadError ? 1 : 0);
  }

  if (!process.stdin.isTTY) {
    console.error("safar: interactive TUI requires a TTY terminal. Use --help for headless options.");
    db.close();
    process.exit(1);
  }

  const { waitUntilExit } = render(<App db={db} />);
  await waitUntilExit();
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
