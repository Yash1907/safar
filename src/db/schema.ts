import type { Database } from "bun:sqlite";

export const SCHEMA_VERSION = 2;

const MIGRATIONS: string[] = [
  // v1 — initial schema (IMPLEMENTATION.md §2)
  `
  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY,
    source_id     TEXT NOT NULL,
    source_job_id TEXT NOT NULL,
    company       TEXT NOT NULL,
    title         TEXT NOT NULL,
    url           TEXT NOT NULL,
    locations     TEXT NOT NULL DEFAULT '[]',
    work_model    TEXT,
    date_posted   INTEGER,
    active        INTEGER NOT NULL DEFAULT 1,
    extra         TEXT NOT NULL DEFAULT '{}',
    first_seen_at INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    UNIQUE (source_id, source_job_id)
  );

  CREATE TABLE IF NOT EXISTS applications (
    job_id     INTEGER PRIMARY KEY REFERENCES jobs(id),
    status     TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_history (
    id         INTEGER PRIMARY KEY,
    job_id     INTEGER NOT NULL REFERENCES jobs(id),
    status     TEXT NOT NULL,
    at         INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2 — skipped_jobs tracking for auto-applier
  `
  CREATE TABLE IF NOT EXISTS skipped_jobs (
    job_id     INTEGER PRIMARY KEY REFERENCES jobs(id),
    reason     TEXT NOT NULL,
    skipped_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_skipped_jobs_skipped_at ON skipped_jobs(skipped_at);
  `,
];

/** Applies any migrations newer than the DB's current meta.schema_version. */
export function migrate(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // meta table must exist before we can read schema_version, so run migration
  // 0 (which creates it) unconditionally, then check version for the rest.
  const current = getSchemaVersion(db);

  db.transaction(() => {
    for (let v = current + 1; v <= MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v - 1]!);
    }
    setMeta(db, "schema_version", String(MIGRATIONS.length));
  })();
}

function getSchemaVersion(db: Database): number {
  const row = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'",
    )
    .get();
  if (!row) return 0;
  const metaRow = db
    .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
    .get("schema_version");
  return metaRow ? Number(metaRow.value) : 0;
}

export function setMeta(db: Database, key: string, value: string): void {
  db.query(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function getMeta(db: Database, key: string): string | null {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
    .get(key);
  return row ? row.value : null;
}
