import type { SourceAdapter } from "./types.ts";
import { createSimplifyAdapter } from "./simplify.ts";
import { createJobrightAdapter } from "./jobright.ts";
import { loadConfig, type RepoSourceConfig, type SafarConfig } from "../config.ts";

/**
 * Builds source adapters from config (§5 M4 — jobright/Simplify repos are
 * config entries, not code; §1.2). Entries with `enabled: false` are
 * skipped.
 */
export function buildSources(config: SafarConfig): SourceAdapter[] {
  const enabled = (entries: RepoSourceConfig[]) => entries.filter((e) => e.enabled !== false);

  return [
    ...enabled(config.sources.simplify).map((c) =>
      createSimplifyAdapter({
        id: c.id,
        displayName: c.displayName,
        owner: c.owner,
        repo: c.repo,
        branch: c.branch,
      }),
    ),
    ...enabled(config.sources.jobright).map((c) =>
      createJobrightAdapter({
        id: c.id,
        displayName: c.displayName,
        owner: c.owner,
        repo: c.repo,
        branch: c.branch,
      }),
    ),
  ];
}

/** v1 default sources (§1), reading `~/.config/safar/config.json` if present. */
export function defaultSources(): SourceAdapter[] {
  return buildSources(loadConfig());
}
