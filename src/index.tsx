import React from "react";
import { render } from "ink";
import { writeFileSync } from "node:fs";
import { openDb, resolveDbPath, listJobs, listTrackedJobs } from "./db/repo.ts";
import { defaultSources } from "./sources/registry.ts";
import { syncAll, formatSyncSummary } from "./sync.ts";
import { exportJobsToCsv, exportJobsToJson, formatFromPath } from "./export.ts";
import { loadConfig } from "./config.ts";
import { loadServiceAccountKey, getAccessToken } from "./google-auth.ts";
import { pushTrackedJobsToSheet, pullTrackedJobsFromSheet, SPREADSHEETS_SCOPE } from "./sheets.ts";
import { App } from "./app.tsx";

interface Args {
  sync: boolean;
  db?: string;
  export?: string;
  sheetsSync: boolean;
  sheetsPull: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { sync: false, sheetsSync: false, sheetsPull: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sync") {
      args.sync = true;
    } else if (arg === "--db") {
      args.db = argv[++i];
    } else if (arg === "--export") {
      args.export = argv[++i];
    } else if (arg === "--sheets-sync") {
      args.sheetsSync = true;
    } else if (arg === "--sheets-pull") {
      args.sheetsPull = true;
    }
  }
  return args;
}

async function runSheetsSync(db: ReturnType<typeof openDb>): Promise<boolean> {
  const config = loadConfig().sheets;
  if (!config) {
    console.error(
      "safar: --sheets-sync requires a \"sheets\" section in ~/.config/safar/config.json (see config.example.json)",
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
      "safar: --sheets-pull requires a \"sheets\" section in ~/.config/safar/config.json (see config.example.json)",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db ?? resolveDbPath();
  const db = openDb(dbPath);

  // Headless mode: --sync, --sheets-pull, --export, --sheets-sync — any combination, run
  // in that order, then exit, no TUI. (§5 M1 CLI smoke test pattern,
  // extended for export/sheets as later additions.)
  if (args.sync || args.export || args.sheetsSync || args.sheetsPull) {
    let hadError = false;

    if (args.sync) {
      const results = await syncAll(db, defaultSources());
      console.log(formatSyncSummary(results));
      hadError = results.some((r) => r.error) || hadError;
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
      // Every job, not just tracked ones — the DB is the system of record
      // (§0), so this is a full backup/portability export, not just a CRM report.
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

  const { waitUntilExit } = render(<App db={db} />);
  await waitUntilExit();
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
