import type { FetchCtx, RawJob, SourceAdapter } from "./types.ts";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export interface ZapplyParseResult {
  jobs: RawJob[];
  skippedRows: number;
}

/**
 * Resolves posted time from zapply markdown. Handles relative time spans like
 * "14m", "6h", "1d", "2w", "1mo", month/day strings like "Aug 13", and
 * "Date unknown" -> undefined.
 */
export function resolveZapplyDatePosted(cell: string, now: Date): Date | undefined {
  const trimmed = cell.trim().toLowerCase();
  if (!trimmed || trimmed.includes("unknown")) return undefined;

  // Relative units: m (minutes), h (hours), d (days), w (weeks), mo (months)
  const relMatch = trimmed.match(
    /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months)$/,
  );
  if (relMatch) {
    const amount = Number(relMatch[1]);
    const unit = relMatch[2]!;
    if (unit.startsWith("m") && !unit.startsWith("mo")) {
      return new Date(now.getTime() - amount * 60 * 1000);
    }
    if (unit.startsWith("h")) {
      return new Date(now.getTime() - amount * 3600 * 1000);
    }
    if (unit.startsWith("d")) {
      return new Date(now.getTime() - amount * 86400 * 1000);
    }
    if (unit.startsWith("w")) {
      return new Date(now.getTime() - amount * 7 * 86400 * 1000);
    }
    if (unit.startsWith("mo")) {
      return new Date(now.getTime() - amount * 30 * 86400 * 1000);
    }
  }

  // Month Day (e.g. "Aug 13", "Sep 18")
  const monthMatch = trimmed.match(/^([a-z]{3,})\s+(\d{1,2})$/);
  if (monthMatch) {
    const monthKey = monthMatch[1]!.slice(0, 3);
    const month = MONTHS[monthKey];
    if (month !== undefined) {
      const day = Number(monthMatch[2]);
      const candidate = new Date(now.getFullYear(), month, day);
      if (candidate.getTime() > now.getTime()) {
        candidate.setFullYear(candidate.getFullYear() - 1);
      }
      return candidate;
    }
  }

  return undefined;
}

/**
 * Derives work model from location cell and role/title.
 * Hybrid is checked before remote so combo strings (e.g. "Hybrid (Remote days)")
 * resolve to hybrid.
 */
export function deriveWorkModel(
  location: string,
  title: string,
): "remote" | "hybrid" | "onsite" | undefined {
  const combined = `${location} ${title}`.toLowerCase();
  if (combined.includes("hybrid")) return "hybrid";
  if (combined.includes("remote")) return "remote";
  if (
    combined.includes("on site") ||
    combined.includes("on-site") ||
    combined.includes("onsite")
  ) {
    return "onsite";
  }
  return undefined;
}

function extractUrl(cell: string): string | undefined {
  // Markdown link with image or text: [...](url)
  const mdMatch = cell.match(/\]\((https?:\/\/[^\s)]+)\)/);
  if (mdMatch) return mdMatch[1];

  // Raw href in HTML: href="..."
  const hrefMatch = cell.match(/href=["'](https?:\/\/[^"']+)["']/i);
  if (hrefMatch) return hrefMatch[1];

  // Plain url
  const plainMatch = cell.match(/(https?:\/\/[^\s]+)/);
  if (plainMatch) return plainMatch[1];

  return undefined;
}

async function sha256Hex(input: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

/**
 * Pure parser for zapply-style job repos (e.g. zapplyjobs/New-Grad-Jobs-2027
 * and zapplyjobs/Internships-2027). Extracts job tables organized by category,
 * parses company, role, location, posted date, visa/sponsorship, and application URLs.
 */
export async function parseZapplyMarkdown(
  sourceId: string,
  markdown: string,
  now: Date,
): Promise<ZapplyParseResult> {
  const lines = markdown.split("\n");
  const jobs: RawJob[] = [];
  let skippedRows = 0;
  let currentCategory: string | undefined = undefined;
  let inTable = false;
  let colIndices = {
    company: -1,
    role: -1,
    location: -1,
    posted: -1,
    visa: -1,
    apply: -1,
  };
  let lastCompany: { name: string; url?: string } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();

    // Category summary tag e.g. <summary><h3>💻 <strong>Software Engineering</strong></h3></summary>
    if (line.includes("<summary>") || line.includes("<h3>")) {
      const clean = line.replace(/<[^>]+>/g, "").replace(/^[^\w\s]+/, "").trim();
      if (clean.length > 0) {
        currentCategory = clean;
      }
    }

    if (line.startsWith("|")) {
      // Detect table header row
      if (
        line.toLowerCase().includes("company") &&
        (line.toLowerCase().includes("role") || line.toLowerCase().includes("title"))
      ) {
        inTable = true;
        const headers = line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim().toLowerCase());
        colIndices = {
          company: headers.findIndex((h) => h.includes("company")),
          role: headers.findIndex(
            (h) => h.includes("role") || h.includes("title") || h.includes("position"),
          ),
          location: headers.findIndex((h) => h.includes("location") || h.includes("loc")),
          posted: headers.findIndex((h) => h.includes("posted") || h.includes("date")),
          visa: headers.findIndex((h) => h.includes("visa") || h.includes("sponsor")),
          apply: headers.findIndex((h) => h.includes("apply") || h.includes("link")),
        };
        lastCompany = null;
        continue;
      }

      if (inTable) {
        // Skip separator row |---|---|...
        if (/^\|[\s:|-]+\|$/.test(line)) continue;

        const cells = line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

        const companyCell =
          colIndices.company >= 0 ? cells[colIndices.company] : undefined;
        const roleCell = colIndices.role >= 0 ? cells[colIndices.role] : undefined;
        const locCell =
          colIndices.location >= 0 ? cells[colIndices.location] : undefined;
        const postedCell =
          colIndices.posted >= 0 ? cells[colIndices.posted] : undefined;
        const visaCell = colIndices.visa >= 0 ? cells[colIndices.visa] : undefined;
        const applyCell =
          colIndices.apply >= 0 ? cells[colIndices.apply] : undefined;

        if (!companyCell || !roleCell) {
          skippedRows++;
          continue;
        }

        // Parse company (bold markdown, link, plain text, or ↳)
        let company = companyCell;
        let companyUrl: string | undefined = undefined;
        if (company === "↳") {
          if (!lastCompany) {
            skippedRows++;
            continue;
          }
          company = lastCompany.name;
          companyUrl = lastCompany.url;
        } else {
          const compLink = company.match(/\[(.+?)\]\((.+?)\)/);
          if (compLink) {
            company = compLink[1]!;
            companyUrl = compLink[2]!;
          }
          company = company.replace(/^[\s*_]+|[\s*_]+$/g, "").trim();
          lastCompany = { name: company, url: companyUrl };
        }

        if (!company) {
          skippedRows++;
          continue;
        }

        // Parse role / title
        let title = roleCell;
        const titleLink = title.match(/\[(.+?)\]\((.+?)\)/);
        if (titleLink) {
          title = titleLink[1]!;
        }
        title = title
          .replace(/\\([\[\]])/g, "$1")
          .replace(/^[\s*_]+|[\s*_]+$/g, "")
          .trim();

        if (!title) {
          skippedRows++;
          continue;
        }

        // Parse application URL
        const jobUrl =
          (applyCell ? extractUrl(applyCell) : undefined) ||
          (titleLink ? titleLink[2] : undefined);
        if (!jobUrl) {
          skippedRows++;
          continue;
        }

        // Stable source job ID from zapply slug /l/d/<slug> or sha256 fallback
        const slugMatch = jobUrl.match(/\/l\/d\/([a-zA-Z0-9_-]+)/i);
        const sourceJobId = slugMatch
          ? slugMatch[1]!
          : await sha256Hex(`${company}|${title}|${locCell ?? ""}`);

        const workModel = deriveWorkModel(locCell ?? "", title);
        const datePosted = postedCell ? resolveZapplyDatePosted(postedCell, now) : undefined;
        const locations = locCell ? [locCell] : [];
        const isClosed =
          roleCell.includes("~~") ||
          companyCell.includes("~~") ||
          title.toLowerCase().includes("[closed]");

        jobs.push({
          sourceId,
          sourceJobId,
          company,
          title,
          url: jobUrl,
          locations,
          workModel,
          datePosted,
          active: !isClosed,
          extra: {
            category: currentCategory,
            sponsorship: visaCell || undefined,
            visa: visaCell || undefined,
            companyUrl,
          },
        });
      }
    } else {
      if (inTable && line.length > 0 && !line.startsWith("|")) {
        inTable = false;
      }
    }
  }

  return { jobs, skippedRows };
}

export function createZapplyAdapter(
  opts: {
    id?: string;
    displayName?: string;
    owner?: string;
    repo?: string;
    branch?: string;
  } = {},
): SourceAdapter {
  const id = opts.id ?? "zapply-newgrad-2027";
  const displayName = opts.displayName ?? "Zapply New Grad 2027";
  const owner = opts.owner ?? "zapplyjobs";
  const repo = opts.repo ?? "New-Grad-Jobs-2027";
  const branch = opts.branch ?? "main";
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;

  return {
    id,
    displayName,
    async fetch(ctx: FetchCtx): Promise<RawJob[]> {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`zapply fetch failed: ${res.status} ${res.statusText}`);
      }
      const markdown = await res.text();
      const { jobs, skippedRows } = await parseZapplyMarkdown(id, markdown, ctx.now);
      ctx.reportSkipped?.(skippedRows);
      return jobs;
    },
  };
}
