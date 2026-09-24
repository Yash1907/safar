import React from "react";
import { Box, Text } from "ink";
import type { JobRecord } from "../db/repo.ts";
import { formatAge } from "../format.ts";
import { detectJobSite } from "../site.ts";
import { detectRoleType, roleBadge } from "../role.ts";

const COL = { site: 16, company: 18, title: 32, location: 15, age: 4 };
const GAP = " ";

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width - 1) + "…";
  return text.padEnd(width);
}

/**
 * Virtualized: only the rows within the visible window are ever rendered
 * (§3 — "Ink chokes on 2k-row lists"). The window scrolls to keep
 * `selectedIndex` in view.
 */
export function JobList({
  jobs,
  selectedIndex,
  isNew,
  nowMs,
  visibleRows,
}: {
  jobs: JobRecord[];
  selectedIndex: number;
  isNew: (job: JobRecord) => boolean;
  nowMs: number;
  visibleRows: number;
}) {
  if (jobs.length === 0) {
    return (
      <Box>
        <Text dimColor>No jobs match this filter.</Text>
      </Box>
    );
  }

  const windowStart = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleRows / 2),
      Math.max(0, jobs.length - visibleRows),
    ),
  );
  const windowEnd = Math.min(jobs.length, windowStart + visibleRows);
  const slice = jobs.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>
          {pad("SITE", COL.site)}
          {GAP}
          {pad("COMPANY", COL.company)}
          {GAP}
          {pad("TITLE", COL.title)}
          {GAP}
          {pad("LOCATION", COL.location)}
          {GAP}
          {pad("AGE", COL.age)}
        </Text>
      </Box>
      {slice.map((job, i) => {
        const absoluteIndex = windowStart + i;
        const selected = absoluteIndex === selectedIndex;
        const age = formatAge(job.datePosted, nowMs);
        const site = detectJobSite(job.url);
        const rowColor = !job.active ? "gray" : undefined;
        const siteColor = !job.active ? "gray" : site.color;
        const badges: string[] = [];
        if (isNew(job)) badges.push("new");
        if (!job.active) badges.push("inactive");
        badges.push(roleBadge(detectRoleType(job)));

        return (
          <Box key={job.id}>
            <Text inverse={selected} color={siteColor} bold={!selected}>
              {pad(site.label, COL.site)}
            </Text>
            <Text inverse={selected} color={rowColor}>
              {GAP}
              {pad(job.company, COL.company)}
              {GAP}
              {pad(job.title, COL.title)}
              {GAP}
              {pad(job.locations.join("/") || "?", COL.location)}
              {GAP}
              {pad(age, COL.age)}
              {badges.length > 0 ? ` ${badges.join(" ")}` : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
