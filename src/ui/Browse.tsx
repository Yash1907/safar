import React from "react";
import { Box, Text } from "ink";
import { FilterBar } from "./FilterBar.tsx";
import { JobList } from "./JobList.tsx";
import type { JobRecord } from "../db/repo.ts";

export function Browse({
  filterText,
  editing,
  onFilterChange,
  onFilterSubmit,
  filteredJobs,
  totalCount,
  newCount,
  selectedIndex,
  isNew,
  nowMs,
  visibleRows,
}: {
  filterText: string;
  editing: boolean;
  onFilterChange: (text: string) => void;
  onFilterSubmit: () => void;
  filteredJobs: JobRecord[];
  totalCount: number;
  newCount: number;
  selectedIndex: number;
  isNew: (job: JobRecord) => boolean;
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
        newCount={newCount}
      />
      <JobList
        jobs={filteredJobs}
        selectedIndex={selectedIndex}
        isNew={isNew}
        nowMs={nowMs}
        visibleRows={visibleRows}
      />
      <Text dimColor>
        j/k/^d/^u/g/G move · / filter · enter detail · o open · s/a status · d delete · u undo · r
        sync · S sheets · q quit
      </Text>
    </Box>
  );
}
