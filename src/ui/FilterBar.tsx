import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function FilterBar({
  filterText,
  editing,
  onChange,
  onSubmit,
  filteredCount,
  totalCount,
  newCount,
}: {
  filterText: string;
  editing: boolean;
  onChange: (text: string) => void;
  onSubmit: () => void;
  filteredCount: number;
  totalCount: number;
  newCount: number;
}) {
  return (
    <Box borderStyle="round" paddingX={1}>
      <Text>filter: </Text>
      {editing ? (
        <TextInput value={filterText} onChange={onChange} onSubmit={onSubmit} />
      ) : (
        <Text dimColor={filterText.length === 0}>
          {filterText.length > 0 ? filterText : "(press / to filter)"}
        </Text>
      )}
      <Text> ── {filteredCount}/{totalCount} jobs ── new:{newCount} </Text>
    </Box>
  );
}
