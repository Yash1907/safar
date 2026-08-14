# safar — terminal job aggregator & application tracker

A TUI app (Ink + TypeScript, compiled with Bun) that pulls job listings from GitHub job repos into a local database, shows what's new since your last check, and tracks your applications through their lifecycle.

Because sources like jobright-ai only retain the last 7 days of postings, **the local database is the system of record** — jobs persist here even after they disappear upstream.

---

## 1. Sources (v1)

Each source is an *adapter* implementing one interface. v1 ships two adapters; more can be added later.

### 1.1 SimplifyJobs (JSON adapter)

- Repos: `SimplifyJobs/New-Grad-Positions` (branch `dev`), optionally `SimplifyJobs/Summer2026-Internships`.
- Fetch `https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json` — **verified working, no API quota consumed** (raw.githubusercontent.com is not rate-limited like the REST API).
- Shape (verified 2026-08-14):
  ```json
  {
    "id": "20fe605e-...",            // stable UUID → use as source_job_id
    "source": "Simplify",
    "category": "Software",          // also "Product", etc. — ingest everything
    "company_name": "Mechanize",
    "title": "Software Engineer",
    "active": false,                  // upstream marks dead postings
    "date_posted": 1767841111,        // unix seconds
    "date_updated": 1767841111,
    "url": "https://jobs.ashbyhq.com/...",
    "locations": ["SF"],
    "sponsorship": "Other",
    "degrees": [],
    "is_visible": true
  }
  ```
- Ingest all categories (user filters in the TUI; `category` is stored in `extra` and filterable via the `cat:` token, see §3). `is_visible === false` and `active === false` are treated identically: the row is still ingested/updated, but stored with `active = 0` — never skipped, never deleted. (Skipping on upsert would silently freeze rows we already store.)
- `workModel` for Simplify: `"remote"` if any entry in `locations` case-insensitively contains "remote"; otherwise `undefined`. The source has no explicit work-model field, so we don't guess hybrid/onsite.

### 1.2 jobright-ai (markdown adapter)

- Repo: `jobright-ai/2026-Software-Engineer-New-Grad`, default branch **`master`** (not `main`).
- Fetch `https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md`.
- Parse only the region after the line containing `TABLE_START`. Table columns (verified): `| Company | Job Title | Location | Work Model | Date Posted |`.
- **Parser rules:**
  - Company cell is `**[Name](url)**`; extract name + company URL with a regex, but tolerate plain-text cells.
  - A company cell of `↳` means "same company as previous row" — carry state while iterating.
  - Job title cell contains the jobright link: `https://jobright.ai/jobs/info/<24-hex-id>?...` → the hex id is the stable `source_job_id`. If a row somehow lacks it, fall back to `sha256(company|title|location)`.
  - `Work Model` cell → enum, case-insensitive substring match: contains "remote" → `remote`; contains "hybrid" → `hybrid`; contains "on site"/"on-site"/"onsite" → `onsite`; anything else → `undefined`, with the raw cell preserved in `extra.workModelRaw`. ("Hybrid/NYC"-style combos hit the first matching rule; hybrid is checked before remote since "hybrid" cells sometimes mention remote days.)
  - `Date Posted` is `Aug 13` with **no year** — resolve to a full date by assuming the most recent past occurrence of that month/day relative to fetch time.
  - Parse defensively: skip malformed rows, count them, surface "N rows skipped" in the sync summary instead of crashing. Markdown sources *will* drift.
- Rows disappearing from the README is normal (7-day window) — absence does **not** mean the job is dead. **v1 rule: the jobright adapter never touches `active`** — jobright jobs stay `active = 1` and the UI shows their age instead. Auto-expiry heuristics are deferred.
- Other jobright repos (`2026-Data-Analysis-New-Grad`, etc.) share the same format, so the adapter takes owner/repo as config → adding more is a config entry, not code.

### 1.3 Adapter interface

```ts
interface SourceAdapter {
  id: string;                       // "simplify-newgrad", "jobright-swe-2026"
  displayName: string;
  fetch(ctx: FetchCtx): Promise<RawJob[]>;   // network only
}

interface RawJob {
  sourceId: string;
  sourceJobId: string;              // stable within the source
  company: string;
  title: string;
  url: string;                      // application link
  locations: string[];
  workModel?: "remote" | "hybrid" | "onsite";
  datePosted?: Date;
  active?: boolean;                 // undefined = unknown
  extra?: Record<string, unknown>;  // sponsorship, category, etc.
}
```

Dedup key in the DB: `(sourceId, sourceJobId)` unique. Cross-source dedup (same job on both Simplify and jobright) is a **non-goal for v1** — fuzzy company+title matching is a rabbit hole; revisit later.

---

## 2. Data model (SQLite via `bun:sqlite`)

`bun:sqlite` is built into Bun, has zero dependencies, and works inside `bun build --compile` binaries. DB lives at `~/.local/share/safar/safar.db` (XDG, overridable via `SAFAR_DB`).

```sql
CREATE TABLE jobs (
  id            INTEGER PRIMARY KEY,
  source_id     TEXT NOT NULL,
  source_job_id TEXT NOT NULL,
  company       TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  locations     TEXT NOT NULL DEFAULT '[]',   -- JSON array
  work_model    TEXT,
  date_posted   INTEGER,                       -- unix seconds
  active        INTEGER NOT NULL DEFAULT 1,
  extra         TEXT NOT NULL DEFAULT '{}',    -- JSON
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE (source_id, source_job_id)
);

CREATE TABLE applications (
  job_id     INTEGER PRIMARY KEY REFERENCES jobs(id),
  status     TEXT NOT NULL,          -- saved|applied|oa|interviewing|offer|rejected|withdrawn
  notes      TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE status_history (        -- audit trail: when did I apply, when rejected
  id         INTEGER PRIMARY KEY,
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  status     TEXT NOT NULL,
  at         INTEGER NOT NULL
);

CREATE TABLE meta (                  -- keys: schema_version, last_sync_at:<sourceId>
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Sync algorithm** (per source, inside one transaction):
1. Fetch + parse → `RawJob[]`.
2. Upsert each row; on insert set `first_seen_at = now`; always bump `last_seen_at`.
3. "New" in the UI = `first_seen_at > previous last_sync_at:<sourceId>`, evaluated per source. Read and hold the previous per-source timestamp *before* the transaction starts; write the new one only on successful commit. Per-source keys keep "new" counts correct when only one source syncs.
4. Report per-source summary: `+N new · M updated · K skipped rows · error?`. One source failing must not abort the others.

---

## 3. TUI design

Two top-level tabs — **Browse** and **Tracker** — switched with `Tab`. **Detail** is a sub-view pushed from either tab via `enter` (dismissed with `esc`), not a tab. Single Ink app, state in a lightweight store (React context + reducer — no Redux/zustand needed).

### View 1 — Browse (default)
```
 safar  ▸ Browse   Tracker                            synced 2m ago
 ┌ filter: react wm:remote_ ── 342/1893 jobs ── new:37 ─────────────┐
 │ Mechanize      Software Engineer              SF        2d  new │
 │ Leidos         Junior ICS/SCADA Engineer      Reston,VA 1d      │
 │ Stripe         SWE, New Grad                  Remote    5h      │
 │ ...                                                             │
 └──────────────────────────────────────────────────────────────────┘
 j/k move · / filter · enter detail · o open · s save · a applied · q quit
```
- **List**: virtualized rendering (only draw visible rows — Ink chokes on 2k-row lists). Sort: newest first, "new since last sync" badged. Default filter: `active` jobs only (inactive reachable via `active:false`).
- **Filter** (`/`): fuzzy match across company + title + location, plus token filters: `loc:<text>`, `wm:remote|hybrid|onsite`, `cat:software` (matches `extra.category`, Simplify-only field — jobright rows have none and are excluded by a `cat:` filter), `src:simplify`, `new:`, `status:applied`, `active:false` (inactive only) / `active:any` (both). Filtering is in-memory over the loaded job list; 2k rows is nothing.
- **Actions**: `o` opens `url` in browser (`open` on macOS), `s` → status *saved*, `a` → *applied*, `enter` → detail pane.

### View 2 — Detail
Full job info + application status + free-text notes (multi-line input) + status history timeline. `1–7` set status, `n` edit notes, `esc` back.

### View 3 — Tracker
Kanban-ish list grouped by status: applied / OA / interviewing / offer / rejected. This is the "job-hunt CRM" view. Shows days-since-last-update per row so stale applications stand out. **Tracker ignores the `active` filter entirely** — a tracked job stays visible here even after its listing goes inactive upstream (rows get an `inactive` badge instead of disappearing).

### Sync
- `r` triggers sync; runs async with a spinner in the header; UI stays interactive.
- Auto-sync on launch if `last_sync_at` older than 6h.

---

## 4. Stack & project layout

- **Runtime/build**: Bun ≥ 1.1. `bun build --compile` for the distributable binary; `bun run src/index.tsx` for dev.
- **TUI**: `ink@5` + `react@18` (Ink 5 pairs with React 18; don't jump to React 19 until Ink officially supports it). `ink-text-input` for the filter/notes fields. No other UI deps — build the list ourselves for virtualization control.
- **DB**: `bun:sqlite` (built in).
- **No HTTP lib**: global `fetch`.
- **Auth**: not needed for v1 fetches (raw.githubusercontent.com is unauthenticated). Keep a `getGithubToken()` helper that shells `gh auth token` (cached, silent failure → null) so future issue-based adapters get 5000 req/h for free.

```
safar/
  src/
    index.tsx            # entrypoint, CLI arg parsing (--sync, --db)
    app.tsx              # root Ink component, view router, keymap
    store.ts             # app state: jobs, filter, selection, sync status
    db/
      schema.ts          # migrations (versioned via meta.schema_version)
      repo.ts            # typed queries: upsertJob, setStatus, listJobs(filter)
    sources/
      types.ts           # SourceAdapter, RawJob
      simplify.ts
      jobright.ts
      registry.ts        # configured source instances
    sync.ts              # orchestrates fetch→upsert, per-source results
    ui/
      Browse.tsx  Detail.tsx  Tracker.tsx
      JobList.tsx          # virtualized list
      FilterBar.tsx  StatusBadge.tsx  Header.tsx
  test/
    jobright.test.ts     # parser vs fixture READMEs (incl. ↳ rows, malformed rows)
    simplify.test.ts
    sync.test.ts         # dedup, first_seen/new-badge semantics
  fixtures/              # frozen copies of real source payloads
  package.json  tsconfig.json  IMPLEMENTATION.md
```

`package.json` scripts:
```json
{
  "dev": "bun run src/index.tsx",
  "test": "bun test",
  "build": "bun build --compile --minify src/index.tsx --outfile dist/safar"
}
```

---

## 5. Milestones

1. **M1 — Data layer, no UI** (do this first; it de-risks everything)
   - Both adapters + fixtures + tests; DB schema + sync. CLI smoke: `bun run src/index.tsx --sync` prints per-source summary.
2. **M2 — Browse view**: virtualized list, filter, open-in-browser, new-badges. *At the end of M2, run `bun build --compile` and verify the binary renders — this is the earliest point the Bun+Ink compile risk (see §6) can bite, and we want to know before building more UI.*
3. **M3 — Tracker**: detail view, statuses, notes, history, Tracker view.
4. **M4 — Polish**: auto-sync, config file (`~/.config/safar/config.json` for enabling/adding jobright repos — JSON so it needs no parser dependency), stats in the header line (counts by status; not a separate view), `--sync` headless mode for cron.

---

## 6. Risks & pushback (read before building)

1. **Bun `--compile` + Ink**: Ink depends on `yoga-layout`, which loads a WASM binary. Bun's compiler usually embeds it correctly, but this is the single biggest technical risk. Mitigation: verify at end of M2 (see above); worst-case fallback is shipping as `bun run` script or `bunx`, which changes nothing about the code.
2. **jobright markdown drift**: the README is machine-generated (good — format is stable-ish) but any upstream template change breaks the parser. Mitigation: defensive parsing + skipped-row counter + fixture tests, so breakage degrades to "0 jobs from jobright, warning shown" rather than a crash.
3. **jobright dates have no year** — the month/day resolution heuristic mis-dates jobs fetched right around New Year. Accepted; postings are never >7 days old at ingest anyway.
4. **Volume**: "ingest everything" from SimplifyJobs includes non-software categories and inactive listings — thousands of rows over time. Fine for SQLite; the UI defaults matter: initial view filters to `active` jobs, everything else reachable via filters.
5. **Cross-source duplicates**: same posting can appear from both sources with no shared ID. v1 shows both. Don't attempt fuzzy dedup in v1.
6. **Scope guard**: the tracker is deliberately job-centric (status + notes + history). No contacts, reminders, or resume-version tracking in v1 — that's a different app.

---

## 7. Non-goals (v1)

- Arbitrary "point at any repo" ingestion — sources are code/config, curated.
- Cross-source fuzzy dedup.
- Scraping company career pages or following jobright redirect targets.
- Notifications/emails (the `--sync` headless mode + `rtk`/cron gets you there later if wanted).
