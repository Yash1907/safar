import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { Database } from "bun:sqlite";
import { getMeta } from "./db/schema.ts";
import {
  listJobs,
  listTrackedJobs,
  setStatus,
  setNotes,
  undoLastStatus,
  deleteApplication,
  getStatusHistory,
  clearStatusHistory,
  STATUS_ORDER,
  type JobRecord,
  type ApplicationStatus,
} from "./db/repo.ts";
import { defaultSources } from "./sources/registry.ts";
import { syncAll } from "./sync.ts";
import { reducer, initialState } from "./store.ts";
import type { ActiveMode } from "./filter.ts";
import { parseFilterQuery, applyFilter } from "./filter.ts";
import { groupTrackedJobs, flattenGroups } from "./tracker.ts";
import { openUrl } from "./open.ts";
import { loadConfig } from "./config.ts";
import { loadServiceAccountKey, getAccessToken } from "./google-auth.ts";
import { pushTrackedJobsToSheet, pullTrackedJobsFromSheet, SPREADSHEETS_SCOPE } from "./sheets.ts";
import { Header } from "./ui/Header.tsx";
import { Browse } from "./ui/Browse.tsx";
import { Detail } from "./ui/Detail.tsx";
import { Tracker } from "./ui/Tracker.tsx";

const AUTO_SYNC_STALE_SEC = 6 * 60 * 60; // §3: auto-sync on launch if last_sync_at older than 6h
const HEADER_ROWS = 2; // tab row + optional stats-by-status row (§5 M4)
const FILTERBAR_ROWS = 3; // round border adds top+bottom
const FOOTER_ROWS = 2; // the keymap hint line is long enough to wrap on narrower terminals
const MARGIN = 1;
const STATUS_KEY_RE = /^[1-7]$/;

function toDbActiveFilter(mode: ActiveMode): "any" | "false" | undefined {
  return mode === "active" ? undefined : mode;
}

function readCutoffs(db: Database, sourceIds: string[]): Record<string, number> {
  const cutoffs: Record<string, number> = {};
  for (const id of sourceIds) {
    const raw = getMeta(db, `last_sync_at:${id}`);
    cutoffs[id] = raw ? Number(raw) : 0;
  }
  return cutoffs;
}

function useTerminalRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setRows(stdout.rows ?? 24);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return rows;
}

export function App({ db }: { db: Database }) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const adapters = useMemo(() => defaultSources(), []);
  const sourceIds = useMemo(() => adapters.map((a) => a.id), [adapters]);
  const terminalRows = useTerminalRows();
  const hydrated = useRef(false);
  const activeModeRef = useRef(state.activeMode);
  activeModeRef.current = state.activeMode;

  const refreshTrackedJobs = useCallback(() => {
    dispatch({ type: "SET_TRACKED_JOBS", jobs: listTrackedJobs(db) });
  }, [db]);

  const runSync = useCallback(async () => {
    const cutoffsBefore = readCutoffs(db, sourceIds);
    dispatch({ type: "SYNC_START" });
    const results = await syncAll(db, adapters, new Date());
    const jobs = listJobs(db, { active: toDbActiveFilter(activeModeRef.current) });
    // Read fresh — a source that errored won't have bumped its last_sync_at,
    // so this is exactly where per-source sync freshness diverges (§ header).
    // 0 means "never synced" (readCutoffs' default), not the unix epoch — drop it.
    const perSourceSyncedAtMs = Object.fromEntries(
      Object.entries(readCutoffs(db, sourceIds))
        .filter(([, sec]) => sec > 0)
        .map(([id, sec]) => [id, sec * 1000]),
    );
    dispatch({
      type: "SYNC_DONE",
      results,
      cutoffs: cutoffsBefore,
      nowMs: Date.now(),
      jobs,
      perSourceSyncedAtMs,
    });
    refreshTrackedJobs();
  }, [db, adapters, sourceIds, refreshTrackedJobs]);

  // Initial hydrate + auto-sync-if-stale (§3 Sync).
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const cutoffs = readCutoffs(db, sourceIds);
    const jobs = listJobs(db, { active: toDbActiveFilter(state.activeMode) });
    const lastSyncValues = Object.values(cutoffs).filter((v) => v > 0);
    const lastSyncedAtMs = lastSyncValues.length
      ? Math.max(...lastSyncValues) * 1000
      : null;
    const perSourceSyncedAtMs = Object.fromEntries(
      Object.entries(cutoffs)
        .filter(([, sec]) => sec > 0)
        .map(([id, sec]) => [id, sec * 1000]),
    );
    dispatch({ type: "HYDRATE", jobs, cutoffs, lastSyncedAtMs, perSourceSyncedAtMs });
    refreshTrackedJobs();

    const nowSec = Math.floor(Date.now() / 1000);
    const stale = sourceIds.some((id) => {
      const at = cutoffs[id] ?? 0;
      return at === 0 || nowSec - at > AUTO_SYNC_STALE_SEC;
    });
    if (stale) {
      void runSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload from DB when the active-jobs mode changes (inactive rows aren't
  // kept in memory by default — §3 "Default filter: active jobs only").
  useEffect(() => {
    if (!hydrated.current) return;
    const jobs = listJobs(db, { active: toDbActiveFilter(state.activeMode) });
    dispatch({ type: "SET_JOBS", jobs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeMode]);

  const parsedFilter = useMemo(() => parseFilterQuery(state.filterText), [state.filterText]);

  // A filter query's `active:` token overrides the sticky activeMode once
  // the user types it (e.g. typing "active:any" reloads from DB).
  useEffect(() => {
    if (parsedFilter.activeMode && parsedFilter.activeMode !== state.activeMode) {
      dispatch({ type: "SET_ACTIVE_MODE", mode: parsedFilter.activeMode });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedFilter.activeMode]);

  const isNew = useCallback(
    (job: JobRecord) => job.firstSeenAt > (state.newCutoffs[job.sourceId] ?? 0),
    [state.newCutoffs],
  );

  const filteredJobs = useMemo(
    () => applyFilter(state.jobs, parsedFilter, isNew),
    [state.jobs, parsedFilter, isNew],
  );
  const newCount = useMemo(() => filteredJobs.filter(isNew).length, [filteredJobs, isNew]);

  const trackedFlat = useMemo(
    () => flattenGroups(groupTrackedJobs(state.trackedJobs)),
    [state.trackedJobs],
  );

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
      ApplicationStatus,
      number
    >;
    for (const job of state.trackedJobs) {
      if (job.status) counts[job.status]++;
    }
    return counts;
  }, [state.trackedJobs]);

  // The list the current tab's j/k/enter/o/s/a operate on.
  const currentList = state.tab === "browse" ? filteredJobs : trackedFlat;
  const selected = currentList[state.selectedIndex];

  const detailJob = state.detailJobId
    ? (state.jobs.find((j) => j.id === state.detailJobId) ??
        state.trackedJobs.find((j) => j.id === state.detailJobId) ??
        null)
    : null;

  // Status-history timeline follows whichever job Detail is showing.
  useEffect(() => {
    if (state.detailJobId === null) {
      dispatch({ type: "SET_STATUS_HISTORY", entries: [] });
      return;
    }
    dispatch({ type: "SET_STATUS_HISTORY", entries: getStatusHistory(db, state.detailJobId) });
  }, [db, state.detailJobId]);

  const applyStatus = useCallback(
    (jobId: number, status: ApplicationStatus) => {
      setStatus(db, jobId, status, Math.floor(Date.now() / 1000));
      dispatch({ type: "UPDATE_JOB_STATUS", jobId, status });
      refreshTrackedJobs();
      // Status history changed for this job — refresh it if Detail is open on it.
      if (jobId === state.detailJobId) {
        dispatch({ type: "SET_STATUS_HISTORY", entries: getStatusHistory(db, jobId) });
      }
    },
    [db, refreshTrackedJobs, state.detailJobId],
  );

  const undoStatus = useCallback(
    (jobId: number) => {
      const restored = undoLastStatus(db, jobId);
      if (restored === null) {
        dispatch({ type: "SET_STATUS_MESSAGE", message: "nothing to undo" });
        return;
      }
      dispatch({ type: "UPDATE_JOB_STATUS", jobId, status: restored });
      dispatch({ type: "SET_STATUS_MESSAGE", message: `undone — back to ${restored}` });
      refreshTrackedJobs();
      if (jobId === state.detailJobId) {
        dispatch({ type: "SET_STATUS_HISTORY", entries: getStatusHistory(db, jobId) });
      }
    },
    [db, refreshTrackedJobs, state.detailJobId],
  );

  const clearHistory = useCallback(
    (jobId: number) => {
      const count = clearStatusHistory(db, jobId);
      dispatch({
        type: "SET_STATUS_MESSAGE",
        message: count > 0 ? `cleared ${count} history entries` : "no history to clear",
      });
      if (jobId === state.detailJobId) {
        dispatch({ type: "SET_STATUS_HISTORY", entries: [] });
      }
    },
    [db, state.detailJobId],
  );

  const deleteApp = useCallback(
    (jobId: number) => {
      const deleted = deleteApplication(db, jobId);
      if (!deleted) {
        dispatch({ type: "SET_STATUS_MESSAGE", message: "not tracked — nothing to delete" });
        return;
      }
      const targetJob =
        state.jobs.find((j) => j.id === jobId) ??
        state.trackedJobs.find((j) => j.id === jobId);
      const company = targetJob?.company ?? "job";
      dispatch({ type: "DELETE_APPLICATION", jobId });
      dispatch({
        type: "SET_STATUS_MESSAGE",
        message: `deleted application for ${company} — like you never applied`,
      });
      refreshTrackedJobs();
      if (jobId === state.detailJobId) {
        dispatch({ type: "SET_STATUS_HISTORY", entries: [] });
      }
    },
    [db, state.jobs, state.trackedJobs, state.detailJobId, refreshTrackedJobs],
  );

  const runSheetsSync = useCallback(async () => {
    dispatch({ type: "SHEETS_SYNC_START" });
    try {
      const config = loadConfig().sheets;
      if (!config) {
        throw new Error('no "sheets" section in ~/.config/safar/config.json');
      }
      if (!config.enabled) {
        dispatch({ type: "SHEETS_SYNC_DONE", message: "sheets sync is disabled in config" });
        return;
      }
      const key = loadServiceAccountKey(config.serviceAccountKeyPath);
      const token = await getAccessToken(key, SPREADSHEETS_SCOPE);
      const jobs = listTrackedJobs(db);
      const { rowCount } = await pushTrackedJobsToSheet(
        token,
        config.spreadsheetId,
        config.sheetName,
        jobs,
      );
      dispatch({
        type: "SHEETS_SYNC_DONE",
        message: `pushed ${rowCount} tracked jobs to Google Sheets`,
      });
    } catch (err) {
      dispatch({
        type: "SHEETS_SYNC_DONE",
        message: `sheets sync failed — ${err instanceof Error ? err.message : err}`,
      });
    }
  }, [db]);

  const runSheetsPull = useCallback(async () => {
    dispatch({ type: "SHEETS_PULL_START" });
    try {
      const config = loadConfig().sheets;
      if (!config) {
        throw new Error('no "sheets" section in ~/.config/safar/config.json');
      }
      if (!config.enabled) {
        dispatch({ type: "SHEETS_SYNC_DONE", message: "sheets sync is disabled in config" });
        return;
      }
      const key = loadServiceAccountKey(config.serviceAccountKeyPath);
      const token = await getAccessToken(key, SPREADSHEETS_SCOPE);
      const { pulledCount, untrackedCount } = await pullTrackedJobsFromSheet(
        token,
        config.spreadsheetId,
        config.sheetName,
        db,
      );
      refreshTrackedJobs();
      const activeFilter = toDbActiveFilter(activeModeRef.current);
      dispatch({ type: "SET_JOBS", jobs: listJobs(db, { active: activeFilter }) });
      if (state.detailJobId !== null) {
        dispatch({ type: "SET_STATUS_HISTORY", entries: getStatusHistory(db, state.detailJobId) });
      }
      const untrackedPart = untrackedCount > 0 ? ` (${untrackedCount} untracked)` : "";
      dispatch({
        type: "SHEETS_SYNC_DONE",
        message: `pulled ${pulledCount} tracked jobs from Google Sheets${untrackedPart}`,
      });
    } catch (err) {
      dispatch({
        type: "SHEETS_SYNC_DONE",
        message: `sheets pull failed — ${err instanceof Error ? err.message : err}`,
      });
    }
  }, [db, refreshTrackedJobs, state.detailJobId]);

  const commitNotes = useCallback(() => {
    if (!detailJob) return;
    setNotes(db, detailJob.id, state.notesDraft, Math.floor(Date.now() / 1000));
    dispatch({ type: "UPDATE_JOB_NOTES", jobId: detailJob.id, notes: state.notesDraft });
    dispatch({ type: "COMMIT_EDIT_NOTES" });
    refreshTrackedJobs();
  }, [db, detailJob, state.notesDraft, refreshTrackedJobs]);

  const visibleRows = Math.max(
    3,
    terminalRows - HEADER_ROWS - FILTERBAR_ROWS - FOOTER_ROWS - MARGIN,
  );

  // Global keymap — suspended while the filter field or notes editor owns input.
  useInput(
    (input, key) => {
      if (input === "q") {
        exit();
        return;
      }
      if (key.tab) {
        dispatch({ type: "SET_TAB", tab: state.tab === "browse" ? "tracker" : "browse" });
        return;
      }
      if (input === "r") {
        void runSync();
        return;
      }
      if (input === "S") {
        void runSheetsSync();
        return;
      }
      if (input === "p") {
        void runSheetsPull();
        return;
      }

      if (state.detailJobId !== null) {
        if (key.escape) {
          dispatch({ type: "CLOSE_DETAIL" });
        } else if (input === "o" && detailJob) {
          openUrl(detailJob.url);
        } else if (input === "n" && detailJob) {
          dispatch({ type: "START_EDIT_NOTES", initial: detailJob.notes ?? "" });
        } else if (STATUS_KEY_RE.test(input) && detailJob) {
          const status = STATUS_ORDER[Number(input) - 1];
          if (status) applyStatus(detailJob.id, status);
        } else if (input === "u" && detailJob) {
          undoStatus(detailJob.id);
        } else if (input === "d" && detailJob) {
          deleteApp(detailJob.id);
        } else if (input === "C" && detailJob) {
          clearHistory(detailJob.id);
        }
        return;
      }

      if (input === "/" && state.tab === "browse") {
        dispatch({ type: "SET_FILTER_EDITING", editing: true });
        return;
      }
      if (input === "j" || key.downArrow) {
        dispatch({ type: "MOVE_SELECTION", delta: 1, max: currentList.length });
        return;
      }
      if (input === "k" || key.upArrow) {
        dispatch({ type: "MOVE_SELECTION", delta: -1, max: currentList.length });
        return;
      }
      if (key.ctrl && input === "d") {
        dispatch({
          type: "MOVE_SELECTION",
          delta: Math.max(1, Math.floor(visibleRows / 2)),
          max: currentList.length,
        });
        return;
      }
      if (key.ctrl && input === "u") {
        dispatch({
          type: "MOVE_SELECTION",
          delta: -Math.max(1, Math.floor(visibleRows / 2)),
          max: currentList.length,
        });
        return;
      }
      if (input === "g") {
        dispatch({ type: "SET_SELECTED_INDEX", index: 0 });
        return;
      }
      if (input === "G") {
        dispatch({ type: "SET_SELECTED_INDEX", index: Math.max(0, currentList.length - 1) });
        return;
      }
      if (key.return && selected) {
        dispatch({ type: "OPEN_DETAIL", jobId: selected.id });
        return;
      }
      if (input === "o" && selected) {
        openUrl(selected.url);
        return;
      }
      if (input === "s" && selected) {
        applyStatus(selected.id, "saved");
        return;
      }
      if (input === "a" && selected) {
        applyStatus(selected.id, "applied");
        return;
      }
      if (input === "u" && selected) {
        undoStatus(selected.id);
        return;
      }
      if (input === "d" && selected) {
        deleteApp(selected.id);
        return;
      }
    },
    { isActive: !state.filterEditing && !state.notesEditing },
  );

  // Escape while editing the filter closes edit mode without clearing text.
  useInput(
    (_input, key) => {
      if (key.escape) dispatch({ type: "SET_FILTER_EDITING", editing: false });
    },
    { isActive: state.filterEditing },
  );

  return (
    <Box flexDirection="column">
      <Header
        tab={state.tab}
        syncStatus={state.syncStatus}
        sources={adapters}
        perSourceSyncedAtMs={state.perSourceSyncedAtMs}
        nowMs={Date.now()}
        statusCounts={statusCounts}
      />
      {detailJob ? (
        <Detail
          job={detailJob}
          statusHistory={state.statusHistory}
          notesEditing={state.notesEditing}
          notesDraft={state.notesDraft}
          onNotesChange={(text) => dispatch({ type: "UPDATE_NOTES_DRAFT", text })}
          onNotesCommit={commitNotes}
          onNotesCancel={() => dispatch({ type: "CANCEL_EDIT_NOTES" })}
          nowMs={Date.now()}
        />
      ) : state.tab === "browse" ? (
        <Browse
          filterText={state.filterText}
          editing={state.filterEditing}
          onFilterChange={(text) => dispatch({ type: "SET_FILTER_TEXT", text })}
          onFilterSubmit={() => dispatch({ type: "SET_FILTER_EDITING", editing: false })}
          filteredJobs={filteredJobs}
          totalCount={state.jobs.length}
          newCount={newCount}
          selectedIndex={state.selectedIndex}
          isNew={isNew}
          nowMs={Date.now()}
          visibleRows={visibleRows}
        />
      ) : (
        <Tracker
          trackedJobs={state.trackedJobs}
          selectedIndex={state.selectedIndex}
          nowMs={Date.now()}
        />
      )}
      {state.statusMessage && <Text dimColor>{state.statusMessage}</Text>}
    </Box>
  );
}
