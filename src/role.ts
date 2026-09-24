export type RoleType = "intern" | "fulltime";

const INTERN_REGEX =
  /\b(intern|internship|co-?op|coop|student|fellow(ship)?|apprentice(ship)?)\b/i;

const FULLTIME_REGEX =
  /\b(full[\s-]?time|ft|new[\s-]?grad(uate)?|university[\s-]?grad(uate)?|entry[\s-]?level|permanent|regular)\b/i;

/**
 * Detects whether a job is an internship/co-op or a full-time/new-grad role.
 */
export function detectRoleType(job: {
  title: string;
  sourceId?: string;
  extra?: Record<string, unknown>;
}): RoleType {
  const title = job.title.trim();

  // 1. Direct title keywords
  if (INTERN_REGEX.test(title)) {
    return "intern";
  }

  if (FULLTIME_REGEX.test(title)) {
    return "fulltime";
  }

  // 2. Check source repository ID
  if (job.sourceId) {
    const sId = job.sourceId.toLowerCase();
    if (sId.includes("intern") || sId.includes("summer")) {
      return "intern";
    }
    if (sId.includes("newgrad") || sId.includes("fulltime")) {
      return "fulltime";
    }
  }

  // 3. Check extra metadata if available
  if (job.extra && typeof job.extra === "object") {
    const extraStr = JSON.stringify(job.extra).toLowerCase();
    if (INTERN_REGEX.test(extraStr)) {
      return "intern";
    }
  }

  // Default fallback for jobs that don't explicitly mention intern
  return "fulltime";
}

/**
 * Human-readable label for the role type.
 */
export function formatRoleType(role: RoleType): string {
  return role === "intern" ? "Internship" : "Full-Time";
}

/**
 * Compact badge label for the role type (e.g. for TUI lists).
 */
export function roleBadge(role: RoleType): string {
  return role === "intern" ? "intern" : "ft";
}
