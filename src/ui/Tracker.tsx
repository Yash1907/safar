import React from "react";
import { Box, Text } from "ink";
import type { JobRecord } from "../db/repo.ts";
import { groupTrackedJobs } from "../tracker.ts";
import { formatAge } from "../format.ts";

const COL = { company: 16, title: 30 };

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width - 1) + "…";
  return text.padEnd(width);
}

/**
 * §3 View 3 — Tracker: kanban-ish list grouped by status (job-hunt CRM).
 * Ignores the `active` filter entirely — inactive-upstream jobs stay
 * visible with an `inactive` badge instead of disappearing. Shows
 * days-since-last-update per row so stale applications stand out.
 */
export function Tracker({
  trackedJobs,
  selectedIndex,
  nowMs,
}: {
  trackedJobs: JobRecord[];
  selectedIndex: number;
  nowMs: number;
}) {
  const groups = groupTrackedJobs(trackedJobs);

  if (groups.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>
          Nothing tracked yet — go to Browse and press `s` (save) or `a` (applied) on a job.
        </Text>
      </Box>
    );
  }

  let cursor = 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      {groups.map((group) => {
        const startIndex = cursor;
        cursor += group.jobs.length;
        return (
          <Box key={group.status} flexDirection="column" marginBottom={1}>
            <Text bold color="cyan">
              {group.status.toUpperCase()} ({group.jobs.length})
            </Text>
            {group.jobs.map((job, i) => {
              const absoluteIndex = startIndex + i;
              const selected = absoluteIndex === selectedIndex;
              const staleness = formatAge(job.updatedAt, nowMs);
              return (
                <Text key={job.id} inverse={selected} color={!job.active ? "gray" : undefined}>
                  {"  "}
                  {pad(job.company, COL.company)}
                  {pad(job.title, COL.title)}
                  {staleness} ago
                  {!job.active ? " inactive" : ""}
                </Text>
              );
            })}
          </Box>
        );
      })}
      <Text dimColor>
        j/k/^d/^u/g/G move · enter detail · o open · s/a status · u undo · r sync · S sheets · q
        quit
      </Text>
    </Box>
  );
}
