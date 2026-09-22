import React from "react";
import { Box, Text } from "ink";
import { FilterBar } from "./FilterBar.tsx";
import { SkippedList } from "./SkippedList.tsx";
import type { SkippedJobRecord } from "../db/repo.ts";

export function Skipped({
  filterText,
  editing,
  onFilterChange,
  onFilterSubmit,
  filteredJobs,
  totalCount,
  selectedIndex,
  nowMs,
  visibleRows,
}: {
  filterText: string;
  editing: boolean;
  onFilterChange: (text: string) => void;
  onFilterSubmit: () => void;
  filteredJobs: SkippedJobRecord[];
  totalCount: number;
  selectedIndex: number;
  nowMs: number;
  visibleRows: number;
}) {
  return (
    <Box flexDirection="column">
      <FilterBar
        filterText={filterText}
        editing={editing}
        onChange={onFilterChange}
        onSubmit={onFilterSubmit}
        filteredCount={filteredJobs.length}
        totalCount={totalCount}
        newCount={0}
      />
      <SkippedList
        jobs={filteredJobs}
        selectedIndex={selectedIndex}
        nowMs={nowMs}
        visibleRows={visibleRows}
      />
      <Text dimColor>
        j/k move · o open to apply manually · a mark applied · enter detail · / filter · Tab switch tabs · q quit
      </Text>
    </Box>
  );
}
