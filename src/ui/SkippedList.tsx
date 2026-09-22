import React from "react";
import { Box, Text } from "ink";
import type { SkippedJobRecord } from "../db/repo.ts";
import { formatAge } from "../format.ts";
import { detectJobSite } from "../site.ts";

const COL = { site: 12, company: 18, title: 26, reason: 32, age: 4 };
const GAP = " ";

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width - 1) + "…";
  return text.padEnd(width);
}

export function SkippedList({
  jobs,
  selectedIndex,
  nowMs,
  visibleRows,
}: {
  jobs: SkippedJobRecord[];
  selectedIndex: number;
  nowMs: number;
  visibleRows: number;
}) {
  if (jobs.length === 0) {
    return (
      <Box>
        <Text dimColor>No skipped jobs found. Run safar --auto-apply to evaluate recent jobs.</Text>
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
          {pad("SKIP REASON", COL.reason)}
          {GAP}
          {pad("AGE", COL.age)}
        </Text>
      </Box>
      {slice.map((job, i) => {
        const absoluteIndex = windowStart + i;
        const selected = absoluteIndex === selectedIndex;
        const age = formatAge(job.datePosted ?? job.firstSeenAt, nowMs);
        const site = detectJobSite(job.url);
        const siteColor = site.color;

        return (
          <Box key={job.id}>
            <Text inverse={selected} color={siteColor} bold={!selected}>
              {pad(site.label, COL.site)}
            </Text>
            <Text inverse={selected}>
              {GAP}
              {pad(job.company, COL.company)}
              {GAP}
              {pad(job.title, COL.title)}
              {GAP}
              <Text color="yellow">{pad(job.skipReason, COL.reason)}</Text>
              {GAP}
              <Text dimColor>{pad(age, COL.age)}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
