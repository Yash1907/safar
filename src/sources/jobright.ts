import type { FetchCtx, RawJob, SourceAdapter } from "./types.ts";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

interface JobrightRow {
  companyCell: string;
  titleCell: string;
  locationCell: string;
  workModelCell: string;
  datePostedCell: string;
}

export interface JobrightParseResult {
  jobs: RawJob[];
  skippedRows: number;
}

/**
 * §1.2 parser rules: only the region after the line containing TABLE_START
 * is parsed. Table columns: Company | Job Title | Location | Work Model | Date Posted.
 */
function extractTableRows(markdown: string): string[] {
  const lines = markdown.split("\n");
  const startIdx = lines.findIndex((l) => l.includes("TABLE_START"));
  const region = startIdx === -1 ? lines : lines.slice(startIdx + 1);

  const rows: string[] = [];
  for (const line of region) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      // Once we've started collecting rows, a non-pipe line ends the table.
      if (rows.length > 0) break;
      continue;
    }
    rows.push(trimmed);
  }

  // Drop header row and the `|---|---|...` separator row.
  return rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r)).slice(1);
}

function splitCells(row: string): string[] {
  // Strip leading/trailing pipe, then split on remaining pipes.
  const inner = row.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/**
 * §1.2: Work Model cell → enum via case-insensitive substring match.
 * Hybrid is checked before remote since "hybrid" cells sometimes mention
 * remote days (e.g. "Hybrid (Remote days available)").
 */
function deriveWorkModel(
  cell: string,
): "remote" | "hybrid" | "onsite" | undefined {
  const lower = cell.toLowerCase();
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("remote")) return "remote";
  if (
    lower.includes("on site") ||
    lower.includes("on-site") ||
    lower.includes("onsite")
  ) {
    return "onsite";
  }
  return undefined;
}

/**
 * §1.2: "Aug 13" has no year — resolve to the most recent past occurrence
 * of that month/day relative to `now`.
 */
export function resolveDatePosted(cell: string, now: Date): Date | undefined {
  const match = cell.trim().match(/^([A-Za-z]{3,})\s+(\d{1,2})$/);
  if (!match) return undefined;
  const monthKey = match[1]!.slice(0, 3).toLowerCase();
  const month = MONTHS[monthKey];
  if (month === undefined) return undefined;
  const day = Number(match[2]);

  const candidate = new Date(now.getFullYear(), month, day);
  if (candidate.getTime() > now.getTime()) {
    candidate.setFullYear(candidate.getFullYear() - 1);
  }
  return candidate;
}

async function sha256Hex(input: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

/**
 * Pure parse function (no network) so it's directly testable against
 * fixtures. Parses defensively: malformed rows are skipped and counted
 * rather than throwing (§1.2 — markdown sources will drift).
 */
export async function parseJobrightMarkdown(
  sourceId: string,
  markdown: string,
  now: Date,
): Promise<JobrightParseResult> {
  const rawRows = extractTableRows(markdown);
  const jobs: RawJob[] = [];
  let skippedRows = 0;
  let lastCompany: { name: string; url?: string } | null = null;

  for (const row of rawRows) {
    const cells = splitCells(row);
    if (cells.length < 5) {
      skippedRows++;
      continue;
    }
    const [companyCell, titleCell, locationCell, workModelCell, datePostedCell] =
      cells as [string, string, string, string, string];

    // Company: "**[Name](url)**", plain text, or "↳" (carry previous company).
    let company: string;
    let companyUrl: string | undefined;
    if (companyCell === "↳") {
      if (!lastCompany) {
        skippedRows++;
        continue;
      }
      company = lastCompany.name;
      companyUrl = lastCompany.url;
    } else {
      const boldLinkMatch = companyCell.match(/\*\*\[(.+?)\]\((.+?)\)\*\*/);
      if (boldLinkMatch) {
        company = boldLinkMatch[1]!;
        companyUrl = boldLinkMatch[2]!;
      } else {
        company = companyCell;
        companyUrl = undefined;
      }
      lastCompany = { name: company, url: companyUrl };
    }

    if (!company) {
      skippedRows++;
      continue;
    }

    // Job title: "[Title](jobright url)".
    const titleMatch = titleCell.match(/\[(.+?)\]\((.+?)\)/);
    if (!titleMatch) {
      skippedRows++;
      continue;
    }
    const title = titleMatch[1]!;
    const jobUrl = titleMatch[2]!;

    const hexMatch = jobUrl.match(/info\/([0-9a-f]{24})/i);
    const sourceJobId = hexMatch
      ? hexMatch[1]!
      : await sha256Hex(`${company}|${title}|${locationCell}`);

    const workModel = deriveWorkModel(workModelCell);
    const datePosted = resolveDatePosted(datePostedCell, now);

    jobs.push({
      sourceId,
      sourceJobId,
      company,
      title,
      url: jobUrl,
      locations: locationCell ? [locationCell] : [],
      workModel,
      datePosted,
      active: true, // §1.2: jobright adapter never touches `active`
      extra: {
        companyUrl,
        workModelRaw: workModel === undefined ? workModelCell : undefined,
      },
    });
  }

  return { jobs, skippedRows };
}

export function createJobrightAdapter(opts: {
  id: string;
  displayName: string;
  owner: string;
  repo: string;
  branch?: string;
}): SourceAdapter {
  const branch = opts.branch ?? "master";
  const url = `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${branch}/README.md`;

  return {
    id: opts.id,
    displayName: opts.displayName,
    async fetch(ctx: FetchCtx): Promise<RawJob[]> {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`jobright fetch failed: ${res.status} ${res.statusText}`);
      }
      const markdown = await res.text();
      const { jobs, skippedRows } = await parseJobrightMarkdown(
        opts.id,
        markdown,
        ctx.now,
      );
      ctx.reportSkipped?.(skippedRows);
      return jobs;
    },
  };
}
