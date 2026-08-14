import type { Database } from "bun:sqlite";
import { setMeta } from "./db/schema.ts";
import { upsertJob } from "./db/repo.ts";
import type { SourceAdapter, SyncResult } from "./sources/types.ts";

const LAST_SYNC_KEY_PREFIX = "last_sync_at:";

/**
 * §2 sync algorithm: fetch+parse, upsert every row inside one transaction,
 * compute "new" via first_seen_at > the previous per-source last_sync_at
 * (read before the transaction, written only on successful commit), and
 * report a per-source summary. One source failing must not abort the others.
 */
export async function syncSource(
  db: Database,
  adapter: SourceAdapter,
  now: Date,
): Promise<SyncResult> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const metaKey = `${LAST_SYNC_KEY_PREFIX}${adapter.id}`;

  try {
    let skippedRows = 0;
    const rawJobs = await adapter.fetch({
      now,
      reportSkipped: (count) => {
        skippedRows += count;
      },
    });

    let newCount = 0;
    let updatedCount = 0;

    db.transaction(() => {
      for (const job of rawJobs) {
        const { isNew } = upsertJob(db, job, nowSec);
        if (isNew) newCount++;
        else updatedCount++;
      }
      setMeta(db, metaKey, String(nowSec));
    })();

    // §2.3: "new" = first_seen_at > the previous per-source last_sync_at.
    // newCount above (rows inserted this run, first_seen_at = nowSec) already
    // satisfies that, since the old meta value was read before we wrote nowSec.
    return {
      sourceId: adapter.id,
      displayName: adapter.displayName,
      newCount,
      updatedCount,
      skippedRows,
    };
  } catch (err) {
    return {
      sourceId: adapter.id,
      displayName: adapter.displayName,
      newCount: 0,
      updatedCount: 0,
      skippedRows: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function syncAll(
  db: Database,
  adapters: SourceAdapter[],
  now: Date = new Date(),
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const adapter of adapters) {
    // Sequential on purpose: keeps per-source transactions from interleaving
    // and keeps the summary output ordered/predictable. Sources are few and
    // fetch latency isn't a concern for v1.
    results.push(await syncSource(db, adapter, now));
  }
  return results;
}

export function formatSyncSummary(results: SyncResult[]): string {
  return results
    .map((r) => {
      if (r.error) return `${r.displayName}: error — ${r.error}`;
      const parts = [`+${r.newCount} new`, `${r.updatedCount} updated`];
      if (r.skippedRows > 0) parts.push(`${r.skippedRows} skipped rows`);
      return `${r.displayName}: ${parts.join(" · ")}`;
    })
    .join("\n");
}
