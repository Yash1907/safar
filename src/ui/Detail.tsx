import React from "react";
import { Box, Text } from "ink";
import type { JobRecord } from "../db/repo.ts";
import { STATUS_ORDER } from "../db/repo.ts";
import type { StatusHistoryEntry } from "../store.ts";
import { formatAge } from "../format.ts";
import { NotesEditor } from "./NotesEditor.tsx";

/**
 * §3 View 2 — Detail: full job info, application status, free-text notes
 * (multi-line), and a status-history timeline. `1-7` set status, `d` delete,
 * `u` undo, `C` clear history (wipes the timeline only — status/notes
 * untouched), `n` edit notes, `esc` back — all handled in app.tsx's
 * keymap; this component is display + the notes editor only.
 */
export function Detail({
  job,
  statusHistory,
  notesEditing,
  notesDraft,
  onNotesChange,
  onNotesCommit,
  onNotesCancel,
  nowMs,
}: {
  job: JobRecord;
  statusHistory: StatusHistoryEntry[];
  notesEditing: boolean;
  notesDraft: string;
  onNotesChange: (text: string) => void;
  onNotesCommit: () => void;
  onNotesCancel: () => void;
  nowMs: number;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>{job.title}</Text>
      <Text>{job.company}</Text>
      <Text dimColor>{job.locations.join(", ") || "location unknown"}</Text>
      {job.workModel && <Text dimColor>work model: {job.workModel}</Text>}
      {Boolean((job.extra as Record<string, unknown>)?.category) && (
        <Text dimColor>category: {String((job.extra as Record<string, unknown>).category)}</Text>
      )}
      {Boolean((job.extra as Record<string, unknown>)?.sponsorship) && (
        <Text dimColor>sponsorship: {String((job.extra as Record<string, unknown>).sponsorship)}</Text>
      )}
      <Text dimColor>source: {job.sourceId}</Text>
      <Text dimColor>{job.active ? "active" : "inactive upstream"}</Text>
      <Text underline>{job.url}</Text>

      <Box marginTop={1}>
        <Text>
          status: <Text bold>{job.status ?? "(untracked)"}</Text>
        </Text>
      </Box>
      <Text dimColor>
        {STATUS_ORDER.map((s, i) => `${i + 1}:${s}`).join("  ")}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>notes:</Text>
        {notesEditing ? (
          <NotesEditor
            value={notesDraft}
            onChange={onNotesChange}
            onCommit={onNotesCommit}
            onCancel={onNotesCancel}
            active={notesEditing}
          />
        ) : job.notes ? (
          job.notes.split(/\r?\n/).map((line, i) => <Text key={i}>{line}</Text>)
        ) : (
          <Text dimColor>(none — press n to add)</Text>
        )}
      </Box>

      {statusHistory.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>history:</Text>
          {statusHistory.map((h, i) => (
            <Text key={i} dimColor>
              {h.status} — {formatAge(h.at, nowMs)} ago
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          1-7 set status · A auto-apply · d delete · u undo · C clear history · o open · n edit notes · esc back
        </Text>
      </Box>
    </Box>
  );
}
