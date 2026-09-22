import React from "react";
import { Box, Text, useInput } from "ink";

/**
 * §3 Detail: free-text notes as a multi-line input. ink-text-input is
 * single-line, so this is a small hand-rolled raw-key editor: printable
 * characters append, Enter inserts a newline, Backspace deletes, Ctrl+S
 * commits, Esc discards. Only active while `active` is true — app.tsx
 * suspends the global keymap for the same duration.
 */
export function NotesEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  active,
}: {
  value: string;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  active: boolean;
}) {
  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.ctrl && input === "s") {
        onCommit();
        return;
      }
      if (key.return) {
        onChange(value + "\n");
        return;
      }
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        onChange(value + input);
      }
    },
    { isActive: active },
  );

  const lines = value.length > 0 ? value.split(/\r?\n/) : [""];

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text dimColor>editing notes — ctrl+s save · esc discard</Text>
      {lines.map((line, i) => (
        <Text key={i}>{line}{i === lines.length - 1 ? "▏" : ""}</Text>
      ))}
    </Box>
  );
}
