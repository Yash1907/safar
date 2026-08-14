import type { FetchCtx, RawJob, SourceAdapter } from "./types.ts";

const LISTINGS_URL =
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";

interface SimplifyEntry {
  id: string;
  source?: string;
  category: string;
  company_name: string;
  title: string;
  active: boolean;
  date_posted: number;
  date_updated?: number;
  url: string;
  locations: string[];
  sponsorship?: string;
  degrees?: string[];
  is_visible: boolean;
}

/**
 * §1.1: `workModel` for Simplify is `"remote"` if any location entry
 * case-insensitively contains "remote"; otherwise undefined (no
 * hybrid/onsite guessing — the source has no explicit work-model field).
 */
function deriveWorkModel(locations: string[]): "remote" | undefined {
  const hasRemote = locations.some((l) => l.toLowerCase().includes("remote"));
  return hasRemote ? "remote" : undefined;
}

/**
 * Pure parse function (no network) so it's directly testable against
 * fixtures. §1.1: is_visible===false and active===false are treated
 * identically — the row is still ingested, just stored with active=0.
 */
export function parseSimplifyJobs(
  sourceId: string,
  entries: SimplifyEntry[],
): RawJob[] {
  return entries.map((e) => {
    const active = e.active !== false && e.is_visible !== false;
    return {
      sourceId,
      sourceJobId: e.id,
      company: e.company_name,
      title: e.title,
      url: e.url,
      locations: e.locations ?? [],
      workModel: deriveWorkModel(e.locations ?? []),
      datePosted: e.date_posted ? new Date(e.date_posted * 1000) : undefined,
      active,
      extra: {
        category: e.category,
        sponsorship: e.sponsorship,
        degrees: e.degrees ?? [],
      },
    } satisfies RawJob;
  });
}

export function createSimplifyAdapter(
  opts: {
    id?: string;
    displayName?: string;
    owner?: string;
    repo?: string;
    branch?: string;
  } = {},
): SourceAdapter {
  const id = opts.id ?? "simplify-newgrad";
  const displayName = opts.displayName ?? "SimplifyJobs New Grad";
  const url =
    opts.owner && opts.repo
      ? `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch ?? "dev"}/.github/scripts/listings.json`
      : LISTINGS_URL;

  return {
    id,
    displayName,
    async fetch(_ctx: FetchCtx): Promise<RawJob[]> {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Simplify fetch failed: ${res.status} ${res.statusText}`);
      }
      const entries = (await res.json()) as SimplifyEntry[];
      return parseSimplifyJobs(id, entries);
    },
  };
}
