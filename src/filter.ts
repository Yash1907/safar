import type { JobRecord } from "./db/repo.ts";
import { detectJobSite } from "./site.ts";

export type ActiveMode = "active" | "any" | "false";

export interface ParsedFilter {
  activeMode: ActiveMode | null; // null = not specified in this query
  company: string | null;
  title: string | null;
  loc: string | null;
  workModel: "remote" | "hybrid" | "onsite" | null;
  category: string | null;
  sourceId: string | null;
  status: string | null;
  wantNew: boolean;
  note: string | null;
  site: string | null;
  freeText: string; // remaining words, space-joined
}

const TOKEN_RE = /^([a-z]+):(.*)$/i;

/**
 * Parses the Browse filter query (§3). Every token below is independently
 * optional and they all AND together, so you can combine as many or as few
 * as you want in one query — e.g. `company:microsoft title:software
 * loc:nyc site:greenhouse` filters all four columns at once, but each of
 * them also works fine completely on its own:
 *
 *   - `company:<text>` — substring match against company name
 *   - `title:<text>` — substring match against job title
 *   - `loc:<text>` — substring match against location
 *   - `site:<text>` — substring match against the detected ATS/job-board
 *     (e.g. "greenhouse", "workday"; see site.ts)
 *   - `wm:remote|hybrid|onsite`
 *   - `cat:<text>` — category (Simplify-only field)
 *   - `src:<text>` — source id
 *   - `status:<text>`
 *   - `note:<text>` — substring match against your own notes
 *   - `new:` — only jobs new since last sync
 *   - `active:false|any` — inactive-only / both (default: active-only)
 *
 * Unrecognized `key:value` tokens are ignored (left out of freeText) rather
 * than treated as literal text, so a typo in a token doesn't silently
 * become a company search for the literal string "wrongtoken:foo".
 *
 * Anything left over (no `key:` prefix) is free text, which also matches
 * company, title, location, notes, and site all at once (see applyFilter)
 * — so plain typing already covers most of what the explicit tokens do.
 * The tokens exist for precision when a word is ambiguous across columns
 * (e.g. a company literally named "Remote"), or when you want to combine a
 * specific column filter with unrelated free text in the same query.
 */
export function parseFilterQuery(input: string): ParsedFilter {
  const parsed: ParsedFilter = {
    activeMode: null,
    company: null,
    title: null,
    loc: null,
    workModel: null,
    category: null,
    sourceId: null,
    status: null,
    wantNew: false,
    note: null,
    site: null,
    freeText: "",
  };

  const freeWords: string[] = [];

  for (const word of input.trim().split(/\s+/).filter(Boolean)) {
    const match = word.match(TOKEN_RE);
    if (!match) {
      freeWords.push(word);
      continue;
    }
    const [, keyRaw, value] = match;
    const key = keyRaw!.toLowerCase();
    switch (key) {
      case "company":
        parsed.company = value ?? "";
        break;
      case "title":
        parsed.title = value ?? "";
        break;
      case "loc":
        parsed.loc = value ?? "";
        break;
      case "wm":
        if (value === "remote" || value === "hybrid" || value === "onsite") {
          parsed.workModel = value;
        }
        break;
      case "cat":
        parsed.category = value ?? "";
        break;
      case "src":
        parsed.sourceId = value ?? "";
        break;
      case "status":
        parsed.status = value ?? "";
        break;
      case "new":
        parsed.wantNew = true;
        break;
      case "note":
        parsed.note = value ?? "";
        break;
      case "site":
        parsed.site = value ?? "";
        break;
      case "active":
        if (value === "any") parsed.activeMode = "any";
        else if (value === "false") parsed.activeMode = "false";
        else parsed.activeMode = "active";
        break;
      default:
        // Unknown token — ignore rather than fall through to free text.
        break;
    }
  }

  parsed.freeText = freeWords.join(" ").toLowerCase();
  return parsed;
}

/**
 * Applies everything except `activeMode` in-memory (§3: "Filtering is
 * in-memory over the loaded job list"). `activeMode` changes the DB query
 * itself (app.tsx reloads from listJobs when it changes), since inactive
 * rows aren't loaded into memory by default.
 */
export function applyFilter(
  jobs: JobRecord[],
  parsed: ParsedFilter,
  isNew: (job: JobRecord) => boolean,
): JobRecord[] {
  return jobs.filter((job) => {
    if (parsed.company && !job.company.toLowerCase().includes(parsed.company.toLowerCase())) {
      return false;
    }
    if (parsed.title && !job.title.toLowerCase().includes(parsed.title.toLowerCase())) {
      return false;
    }
    if (parsed.loc) {
      const needle = parsed.loc.toLowerCase();
      if (!job.locations.some((l) => l.toLowerCase().includes(needle))) return false;
    }
    if (parsed.workModel && job.workModel !== parsed.workModel) return false;
    if (parsed.category) {
      const cat = String((job.extra as any)?.category ?? "").toLowerCase();
      if (cat !== parsed.category.toLowerCase()) return false;
    }
    if (parsed.sourceId && !job.sourceId.toLowerCase().includes(parsed.sourceId.toLowerCase())) {
      return false;
    }
    if (parsed.status && job.status !== parsed.status) return false;
    if (parsed.wantNew && !isNew(job)) return false;
    if (parsed.note) {
      const notes = (job.notes ?? "").toLowerCase();
      if (!notes.includes(parsed.note.toLowerCase())) return false;
    }
    if (parsed.site) {
      const site = detectJobSite(job.url).label.toLowerCase();
      if (!site.includes(parsed.site.toLowerCase())) return false;
    }

    if (parsed.freeText) {
      const haystack = `${job.company} ${job.title} ${job.locations.join(" ")} ${job.notes ?? ""} ${detectJobSite(job.url).label}`.toLowerCase();
      const words = parsed.freeText.split(/\s+/).filter(Boolean);
      if (!words.every((w) => haystack.includes(w))) return false;
    }

    return true;
  });
}
