import type { JobRecord, ApplicationStatus } from "./db/repo.ts";
import type { ActiveMode } from "./filter.ts";
import type { SyncResult } from "./sources/types.ts";

export type Tab = "browse" | "tracker";

export interface StatusHistoryEntry {
  status: string;
  at: number;
}

export interface AppState {
  tab: Tab;
  detailJobId: number | null;
  jobs: JobRecord[]; // Browse's currently loaded list, respecting activeMode
  trackedJobs: JobRecord[]; // Tracker's list — ignores activeMode, requires a status (§3 View 3)
  activeMode: ActiveMode;
  filterText: string;
  filterEditing: boolean;
  selectedIndex: number;
  syncStatus: "idle" | "syncing";
  sheetsSyncStatus: "idle" | "syncing";
  /** per-source last_sync_at as of the moment *before* the most recent sync started this session — used to compute "new" badges. */
  newCutoffs: Record<string, number>;
  lastSyncedAtMs: number | null;
  /** per-source last_sync_at *as of right now* (post-sync) — surfaces in the header when sources diverge, e.g. one failed. */
  perSourceSyncedAtMs: Record<string, number>;
  statusMessage: string | null;
  statusHistory: StatusHistoryEntry[];
  notesEditing: boolean;
  notesDraft: string;
}

export type Action =
  | {
      type: "HYDRATE";
      jobs: JobRecord[];
      cutoffs: Record<string, number>;
      lastSyncedAtMs: number | null;
      perSourceSyncedAtMs: Record<string, number>;
    }
  | { type: "SET_TAB"; tab: Tab }
  | { type: "OPEN_DETAIL"; jobId: number }
  | { type: "CLOSE_DETAIL" }
  | { type: "SET_JOBS"; jobs: JobRecord[] }
  | { type: "SET_ACTIVE_MODE"; mode: ActiveMode }
  | { type: "SET_FILTER_TEXT"; text: string }
  | { type: "SET_FILTER_EDITING"; editing: boolean }
  | { type: "MOVE_SELECTION"; delta: number; max: number }
  | { type: "SET_SELECTED_INDEX"; index: number }
  | { type: "SYNC_START" }
  | {
      type: "SYNC_DONE";
      results: SyncResult[];
      cutoffs: Record<string, number>;
      nowMs: number;
      jobs: JobRecord[];
      perSourceSyncedAtMs: Record<string, number>;
    }
  | { type: "UPDATE_JOB_STATUS"; jobId: number; status: ApplicationStatus }
  | { type: "UPDATE_JOB_NOTES"; jobId: number; notes: string }
  | { type: "SET_STATUS_MESSAGE"; message: string | null }
  | { type: "SET_TRACKED_JOBS"; jobs: JobRecord[] }
  | { type: "SET_STATUS_HISTORY"; entries: StatusHistoryEntry[] }
  | { type: "START_EDIT_NOTES"; initial: string }
  | { type: "UPDATE_NOTES_DRAFT"; text: string }
  | { type: "CANCEL_EDIT_NOTES" }
  | { type: "COMMIT_EDIT_NOTES" }
  | { type: "DELETE_APPLICATION"; jobId: number }
  | { type: "SHEETS_SYNC_START" }
  | { type: "SHEETS_SYNC_DONE"; message: string };

export function initialState(): AppState {
  return {
    tab: "browse",
    detailJobId: null,
    jobs: [],
    trackedJobs: [],
    activeMode: "active",
    filterText: "",
    filterEditing: false,
    selectedIndex: 0,
    syncStatus: "idle",
    sheetsSyncStatus: "idle",
    newCutoffs: {},
    lastSyncedAtMs: null,
    perSourceSyncedAtMs: {},
    statusMessage: null,
    statusHistory: [],
    notesEditing: false,
    notesDraft: "",
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "HYDRATE":
      return {
        ...state,
        jobs: action.jobs,
        newCutoffs: action.cutoffs,
        lastSyncedAtMs: action.lastSyncedAtMs,
        perSourceSyncedAtMs: action.perSourceSyncedAtMs,
        selectedIndex: 0,
      };
    case "SET_TAB":
      return { ...state, tab: action.tab, detailJobId: null, selectedIndex: 0 };
    case "OPEN_DETAIL":
      return { ...state, detailJobId: action.jobId };
    case "CLOSE_DETAIL":
      return { ...state, detailJobId: null };
    case "SET_JOBS":
      return { ...state, jobs: action.jobs, selectedIndex: 0 };
    case "SET_ACTIVE_MODE":
      return { ...state, activeMode: action.mode };
    case "SET_FILTER_TEXT":
      return { ...state, filterText: action.text, selectedIndex: 0 };
    case "SET_FILTER_EDITING":
      return { ...state, filterEditing: action.editing };
    case "MOVE_SELECTION": {
      if (action.max <= 0) return { ...state, selectedIndex: 0 };
      const next = Math.min(Math.max(state.selectedIndex + action.delta, 0), action.max - 1);
      return { ...state, selectedIndex: next };
    }
    case "SET_SELECTED_INDEX":
      return { ...state, selectedIndex: action.index };
    case "SYNC_START":
      return { ...state, syncStatus: "syncing", statusMessage: null };
    case "SYNC_DONE": {
      const errored = action.results.filter((r) => r.error);
      const newTotal = action.results.reduce((s, r) => s + r.newCount, 0);
      const skipped = action.results.reduce((s, r) => s + r.skippedRows, 0);
      const parts = [`+${newTotal} new`];
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (errored.length > 0) {
        parts.push(`${errored.length} source(s) failed`);
      }
      return {
        ...state,
        syncStatus: "idle",
        newCutoffs: action.cutoffs,
        lastSyncedAtMs: action.nowMs,
        perSourceSyncedAtMs: action.perSourceSyncedAtMs,
        statusMessage: parts.join(" · "),
        jobs: action.jobs,
        selectedIndex: 0,
      };
    }
    case "UPDATE_JOB_STATUS":
      return {
        ...state,
        jobs: state.jobs.map((j) =>
          j.id === action.jobId ? { ...j, status: action.status } : j,
        ),
        trackedJobs: state.trackedJobs.map((j) =>
          j.id === action.jobId ? { ...j, status: action.status } : j,
        ),
      };
    case "UPDATE_JOB_NOTES":
      return {
        ...state,
        jobs: state.jobs.map((j) =>
          j.id === action.jobId ? { ...j, notes: action.notes } : j,
        ),
        trackedJobs: state.trackedJobs.map((j) =>
          j.id === action.jobId ? { ...j, notes: action.notes } : j,
        ),
      };
    case "SET_STATUS_MESSAGE":
      return { ...state, statusMessage: action.message };
    case "SET_TRACKED_JOBS":
      return { ...state, trackedJobs: action.jobs };
    case "SET_STATUS_HISTORY":
      return { ...state, statusHistory: action.entries };
    case "START_EDIT_NOTES":
      return { ...state, notesEditing: true, notesDraft: action.initial };
    case "UPDATE_NOTES_DRAFT":
      return { ...state, notesDraft: action.text };
    case "CANCEL_EDIT_NOTES":
      return { ...state, notesEditing: false, notesDraft: "" };
    case "COMMIT_EDIT_NOTES":
      return { ...state, notesEditing: false };
    case "DELETE_APPLICATION":
      return {
        ...state,
        jobs: state.jobs.map((j) =>
          j.id === action.jobId
            ? { ...j, status: null, notes: null, updatedAt: null }
            : j,
        ),
        trackedJobs: state.trackedJobs.filter((j) => j.id !== action.jobId),
      };
    case "SHEETS_SYNC_START":
      return { ...state, sheetsSyncStatus: "syncing", statusMessage: "pushing to Google Sheets…" };
    case "SHEETS_SYNC_DONE":
      return { ...state, sheetsSyncStatus: "idle", statusMessage: action.message };
    default:
      return state;
  }
}
