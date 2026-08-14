export interface SiteInfo {
  label: string;
  color: string;
}

// Longest/most-specific hostname substrings first so e.g. a company's own
// "jobs.<company>.com" doesn't accidentally shadow a real ATS match.
const KNOWN_SITES: [pattern: string, label: string, color: string][] = [
  ["boards.greenhouse.io", "greenhouse", "green"],
  ["greenhouse.io", "greenhouse", "green"],
  ["jobs.lever.co", "lever", "blue"],
  ["lever.co", "lever", "blue"],
  ["myworkdayjobs.com", "workday", "yellow"],
  ["workday.com", "workday", "yellow"],
  ["jobs.ashbyhq.com", "ashby", "magenta"],
  ["ashbyhq.com", "ashby", "magenta"],
  ["icims.com", "icims", "cyan"],
  ["smartrecruiters.com", "smartrecruiters", "red"],
  ["jobvite.com", "jobvite", "redBright"],
  ["taleo.net", "taleo", "yellowBright"],
  ["successfactors.com", "successfactors", "blueBright"],
  ["bamboohr.com", "bamboohr", "greenBright"],
  ["breezy.hr", "breezy", "cyanBright"],
  ["workable.com", "workable", "magentaBright"],
  ["recruitee.com", "recruitee", "cyan"],
  ["personio.com", "personio", "blue"],
  ["jobright.ai", "jobright", "gray"],
  ["linkedin.com", "linkedin", "blueBright"],
  ["indeed.com", "indeed", "blueBright"],
];

/**
 * Best-effort ATS/job-board detection from a job's application URL, purely
 * from the hostname — no following redirects (§7 non-goal). jobright rows
 * store the jobright.ai redirect link itself (§1.2), so they always show
 * "jobright" here rather than the underlying ATS.
 */
export function detectJobSite(url: string): SiteInfo {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { label: "?", color: "gray" };
  }

  for (const [pattern, label, color] of KNOWN_SITES) {
    if (hostname.includes(pattern)) return { label, color };
  }

  // Fallback: the registrable-ish domain segment (e.g. "stripe.com" -> "stripe"),
  // so an unrecognized ATS/company site still gets a short, readable label.
  const parts = hostname.replace(/^www\./, "").split(".");
  const label = parts.length >= 2 ? parts[parts.length - 2]! : hostname;
  return { label, color: "white" };
}
