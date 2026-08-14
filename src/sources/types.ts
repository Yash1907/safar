export interface FetchCtx {
  now: Date;
  /**
   * Adapters that skip malformed rows (e.g. jobright's markdown parser)
   * call this so sync.ts can surface "K skipped rows" in the per-source
   * summary (§2.4) without widening the fetch() return type.
   */
  reportSkipped?: (count: number) => void;
}

export interface SourceAdapter {
  id: string; // "simplify-newgrad", "jobright-swe-2026"
  displayName: string;
  fetch(ctx: FetchCtx): Promise<RawJob[]>; // network only
}

export interface RawJob {
  sourceId: string;
  sourceJobId: string; // stable within the source
  company: string;
  title: string;
  url: string; // application link
  locations: string[];
  workModel?: "remote" | "hybrid" | "onsite";
  datePosted?: Date;
  active?: boolean; // undefined = unknown
  extra?: Record<string, unknown>; // sponsorship, category, etc.
}

export interface SyncResult {
  sourceId: string;
  displayName: string;
  newCount: number;
  updatedCount: number;
  skippedRows: number;
  error?: string;
}
