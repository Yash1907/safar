import React from "react";
import { Box, Text } from "ink";
import type { Tab } from "../store.ts";
import { formatAge } from "../format.ts";
import { STATUS_ORDER, type ApplicationStatus } from "../db/repo.ts";

/** §5 M4: "stats in the header line (counts by status; not a separate view)". */
export function formatStatusCounts(counts: Record<ApplicationStatus, number>): string {
  return STATUS_ORDER.filter((s) => counts[s] > 0)
    .map((s) => `${s}:${counts[s]}`)
    .join(" · ");
}

export interface SourceMeta {
  id: string;
  displayName: string;
}

// Sources normally finish a full sync within the same batch (same "now"),
// so they land on the same timestamp. A gap bigger than this means one of
// them fell behind — almost always because it errored (§2.4) — worth
// calling out explicitly rather than reporting a single misleading average.
const DIVERGENCE_THRESHOLD_MS = 30 * 60 * 1000;

function shortLabel(id: string): string {
  return id.split("-")[0] ?? id;
}

/**
 * A single aggregate "synced Xm ago" when every source is roughly in sync;
 * a per-source breakdown (surfacing "never" for anything that hasn't
 * completed) once they diverge — e.g. one source has been failing.
 */
export function formatSyncLabel(
  sources: SourceMeta[],
  perSourceSyncedAtMs: Record<string, number>,
  syncStatus: "idle" | "syncing",
  nowMs: number,
): string {
  if (syncStatus === "syncing") return "syncing…";
  if (sources.length === 0) return "never synced";

  const values = sources.map((s) => perSourceSyncedAtMs[s.id] ?? null);
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return "never synced";

  const anyMissing = values.some((v) => v === null);
  const spread = Math.max(...present) - Math.min(...present);

  if (!anyMissing && spread <= DIVERGENCE_THRESHOLD_MS) {
    return `synced ${formatAge(Math.floor(Math.max(...present) / 1000), nowMs)} ago`;
  }

  return sources
    .map((s, i) => {
      const v = values[i];
      return `${shortLabel(s.id)} ${v ? formatAge(Math.floor(v / 1000), nowMs) + " ago" : "never"}`;
    })
    .join(" · ");
}

export function Header({
  tab,
  syncStatus,
  sources,
  perSourceSyncedAtMs,
  nowMs,
  statusCounts,
}: {
  tab: Tab;
  syncStatus: "idle" | "syncing";
  sources: SourceMeta[];
  perSourceSyncedAtMs: Record<string, number>;
  nowMs: number;
  statusCounts: Record<ApplicationStatus, number>;
}) {
  const syncLabel = formatSyncLabel(sources, perSourceSyncedAtMs, syncStatus, nowMs);
  const statsLabel = formatStatusCounts(statusCounts);

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Box>
          <Text bold>safar</Text>
          <Text>  </Text>
          <Text bold={tab === "browse"} color={tab === "browse" ? "cyan" : undefined}>
            ▸ Browse
          </Text>
          <Text>   </Text>
          <Text bold={tab === "tracker"} color={tab === "tracker" ? "cyan" : undefined}>
            Tracker
          </Text>
        </Box>
        <Text dimColor>{syncLabel}</Text>
      </Box>
      {statsLabel && <Text dimColor>{statsLabel}</Text>}
    </Box>
  );
}
