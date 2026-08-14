/** Formats a unix-seconds timestamp as a short relative age, e.g. "2d", "5h", "37m", "now". */
export function formatAge(timestampSec: number | null, nowMs: number): string {
  if (timestampSec === null) return "?";
  const diffMs = nowMs - timestampSec * 1000;
  if (diffMs < 0) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
