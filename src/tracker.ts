import { STATUS_ORDER, type ApplicationStatus, type JobRecord } from "./db/repo.ts";

export interface TrackerGroup {
  status: ApplicationStatus;
  jobs: JobRecord[];
}

/**
 * Groups tracked jobs by status (lifecycle order, §3 View 3), sorted
 * oldest-updated-first within each group so stale applications stand out.
 * Also used by app.tsx to build the flat selection order — must match
 * Tracker.tsx's rendering order exactly (see flattenGroups below).
 */
export function groupTrackedJobs(jobs: JobRecord[]): TrackerGroup[] {
  return STATUS_ORDER.map((status) => ({
    status,
    jobs: jobs
      .filter((j) => j.status === status)
      .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0)),
  })).filter((g) => g.jobs.length > 0);
}

export function flattenGroups(groups: TrackerGroup[]): JobRecord[] {
  return groups.flatMap((g) => g.jobs);
}
