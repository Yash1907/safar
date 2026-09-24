import { detectJobSite } from "./site.ts";
import type { JobRecord } from "./db/repo.ts";

export type SupportedPlatform = "greenhouse" | "ashby";

export interface QuestionInfo {
  id?: string;
  label: string;
  type?: string;
  required: boolean;
  options?: string[];
  description?: string;
}

export interface ClassificationResult {
  platform: SupportedPlatform | "other";
  isEligiblePlatform: boolean;
  isDefaultJob: boolean;
  reason?: string;
  questions?: QuestionInfo[];
  jobTitle?: string;
}

// Regex patterns that define allowed standard/default questions
const STANDARD_FIELD_PATTERNS = [
  // Contact & Personal Info
  /\bnames?\b/i,
  /\bfirst\s*name\b/i,
  /\blast\s*name\b/i,
  /\bfull\s*name\b/i,
  /\blegal\s*name\b/i,
  /\bsurname\b/i,
  /\bmiddle\s*name\b/i,
  /\bpreferred\s*name\b/i,
  /\bemail\b/i,
  /\bphone\b/i,
  /\bmobile\b/i,
  /\btelephone\b/i,
  /\baddress\b/i,
  /\bcity\b/i,
  /\bstate\b/i,
  /\bcountry\b/i,
  /\bpostal\b/i,
  /\bzip\b/i,
  /\blocation\b/i,
  /\bcurrent\s*location\b/i,
  /\bwhere\s*(are\s*you|do\s*you)\s*(currently\s*)?(located|live|reside|work|intend)\b/i,
  /\bintended\s*work\s*location\b/i,

  // Resume & Documents
  /\bresume\b/i,
  /\bcv\b/i,
  /\bcurriculum\s*vitae\b/i,
  /\bcover\s*letter\b/i, // Optional cover letters are fine

  // Links & Profiles
  /\blinkedin\b/i,
  /\bgithub\b/i,
  /\bwebsite\b/i,
  /\bportfolio\b/i,
  /\btwitter\b/i,
  /\bsocial\s*media\b/i,
  /\burl\b/i,
  /\blink\b/i,

  // Education / Academic
  /\bschool\b/i,
  /\buniversity\b/i,
  /\bcollege\b/i,
  /\binstitution\b/i,
  /\bdegree\b/i,
  /\bdiscipline\b/i,
  /\bmajor\b/i,
  /\bfield\s*of\s*study\b/i,
  /\beducation\b/i,
  /\bgraduation\b/i,
  /\bgraduate\b/i,
  /\bgraduating\b/i,
  /\bexpect(ed|ing)?\s*to\s*graduate\b/i,
  /\bstudent\b/i,
  /\benrolled\b/i,
  /\bclass\s*of\b/i,
  /\bgpa\b/i,
  /\bgrade\s*point\s*average\b/i,
  /\bacademic\b/i,
  /\bcoursework\b/i,
  /\bstandardized\s*test\b/i,
  /\bsat\b/i,
  /\bact\b/i,
  /\bgre\b/i,

  // Experience & Employment
  /\bexperience\b/i,
  /\bemployment\b/i,
  /\bwork\s*history\b/i,
  /\bcompany\b/i,
  /\bemployer\b/i,
  /\bjob\s*title\b/i,
  /\bcurrent\s*(title|company|role|employer)\b/i,

  // Work Authorization / Legal Right to Work / Immigration
  /\bright\s*to\s*work\b/i,
  /\blegal\s*rights?\b/i,
  /\bauthorized\s*to\s*work\b/i,
  /\bauthori[sz]ation\b/i,
  /\blegally\s*(authorized|eligible|permitted|entitled)\b/i,
  /\blawfully\s*(authorized|eligible|permitted|entitled)\b/i,
  /\beligib(le|ility)\s*to\s*work\b/i,
  /\bwork\s*permit\b/i,
  /\bemployment\s*authori[sz]ation\b/i,
  /\bimmigration\s*status\b/i,
  /\bcitizen(ship)?\b/i,
  /\bpermanent\s*resident\b/i,
  /\bgreen\s*card\b/i,
  /\bvisas?\b/i,
  /\bsponsorship\b/i,
  /\brequire\s*(visa\s*)?sponsorship\b/i,
  /\bnow\s*or\s*in\s*the\s*future.*sponsorship\b/i,
  /\bh-?1b\b/i,
  /\bopt\b/i,
  /\bcpt\b/i,
  /\bstem\s*opt\b/i,
  /\bu\.?s\.?\s*person\b/i,
  /\bitar\b/i,
  /\bexport\s*control\b/i,

  // Workplace Preferences & Requirements
  /\b18\s*(years|or\s*older|\+)\b/i,
  /\bat\s*least\s*18\b/i,
  /\bage\s*requirement\b/i,
  /\blegal\s*age\b/i,
  /\bonsite\b/i,
  /\bcommute\b/i,
  /\bin-?office\b/i,
  /\boffice\b/i,
  /\brelocate\b/i,
  /\brelocation\b/i,
  /\bhybrid\b/i,
  /\bdays?\s*(per|a)\s*week\b/i,
  /\bwork\s*out\s*of\b/i,
  /\bwork\s*from\b/i,
  /\btravel\b/i,

  // Availability & Term
  /\bstart\s*date\b/i,
  /\bearliest\s*(start|availab\w*)\b/i,
  /\bavailab(le|ility)\b/i,
  /\bwhen.*(start|begin)\b/i,
  /\blook\s*to\s*start\b/i,
  /\bseason\b/i,
  /\bterm\b/i,
  /\bsemester\b/i,
  /\bquarter\b/i,
  /\bspring|summer|fall|winter\b/i,

  // EEO Demographics (Voluntary Self-ID)
  /\bgender\b/i,
  /\brace\b/i,
  /\bethnicity\b/i,
  /\bhispanic\b/i,
  /\blatino\b/i,
  /\bveteran\b/i,
  /\bdisability\b/i,
  /\bvoluntary\s*self-identification\b/i,
  /\beo(e|o)\b/i,
  /\bsexual\s*orientation\b/i,
  /\bpronouns\b/i,

  // Consents & Acknowledgments
  /\bconsent\b/i,
  /\bterms\b/i,
  /\bprivacy\s*policy\b/i,
  /\btexting\b/i,
  /\bsms\b/i,
  /\bwhatsapp\b/i,
  /\backnowledge\b/i,
  /\bcertify\b/i,
  /\baffirm\b/i,
  /\bagreement\b/i,

  // Source & Referral
  /\bhear\s*about\b/i,
  /\bconnect(ed)?\s*with\s*us\b/i,
  /\bhow\s*did\s*you\s*(hear|find|connect)\b/i,
  /\bwhere\s*did\s*you\s*(hear|find)\b/i,
  /\bsource\b/i,
  /\breferral\b/i,
  /\breferred\b/i,

  // Standard Company / Employment Checks
  /\bpreviously\s*(worked|employed|applied)\b/i,
  /\bformer\s*(employee|intern)\b/i,
  /\bever\s*worked\s*at\b/i,
  /\bnon-?compete\b/i,
  /\bnotice\s*period\b/i,
  /\brestrictive\s*covenant\b/i,
  /\bconflict\s*of\s*interest\b/i,
  /\bbackground\s*check\b/i,
  /\bdrug\s*(screen|test)\b/i,

  // Compensation / Salary (Numeric or Standard Rate)
  /\bcompensation\b/i,
  /\bsalary\b/i,
  /\bpay\s*expectation\b/i,
  /\bdesired\s*salary\b/i,
  /\btarget\s*compensation\b/i,

  // Clarifications / Other
  /\bif\s*you\s*selected\s*.*other\b/i,
  /\bplease\s*specify\b/i,
  /\bother\b/i,
];

// Patterns that identify custom/essay questions that DISQUALIFY a job from being "default"
const CUSTOM_QUESTION_PATTERNS = [
  /\bwhy\b/i,
  /\bchallenge\b/i,
  /\baccomplish(ment)?\b/i,
  /\bproud(est)?\b/i,
  /\bdescribe\b/i,
  /\btell\s+us\b/i,
  /\bshare\s+(about|with\s+us|a\s+project|how|something|an\s+example|details)\b/i,
  /\bwhat\s+(makes|motivates|interests|excites|drives|inspires)\b/i,
  /\bwhat\s+is\s+the\s+(most|hardest|biggest|greatest)\b/i,
  /\bwhat\s+are\s+you\s+looking\b/i,
  /\bwriting\s+sample\b/i,
  /\bcode\s+sample\b/i,
  /\btake-?home\b/i,
  /\bessay\b/i,
  /\bcover\s*letter\s*\(required\)\b/i,
  /\b\d+\s*(to\s*\d+\s*)?sentences?\b/i,
  /\bexplain\s*your\s*interest\b/i,
];

/**
 * Checks if a question label/prompt is a standard default field.
 */
export function isStandardQuestion(label: string): boolean {
  const clean = label.trim();
  if (!clean) return true;
  return STANDARD_FIELD_PATTERNS.some((pattern) => pattern.test(clean));
}

/**
 * Checks if a question explicitly matches custom essay question patterns.
 */
export function isCustomQuestion(label: string): boolean {
  const clean = label.trim();
  if (!clean) return false;
  return CUSTOM_QUESTION_PATTERNS.some((pattern) => pattern.test(clean));
}

/**
 * Detects whether a URL belongs to Greenhouse or Ashby.
 */
export function detectPlatform(url: string): SupportedPlatform | "other" {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("greenhouse.io")) return "greenhouse";
    if (host.includes("ashbyhq.com")) return "ashby";
  } catch {
    // ignore invalid URLs
  }
  return "other";
}

/**
 * Parses Greenhouse board token and job ID from URL.
 */
export function parseGreenhouseUrl(
  url: string,
): { board: string; jobId: string } | null {
  try {
    const parsed = new URL(url);
    // e.g. https://job-boards.greenhouse.io/singlestore/jobs/8221924
    // e.g. https://boards.greenhouse.io/singlestore/jobs/8221924
    const match = parsed.pathname.match(/\/([^/]+)\/jobs\/(\d+)/);
    if (match && match[1] && match[2]) {
      return { board: match[1], jobId: match[2] };
    }
    // e.g. https://boards.greenhouse.io/embed/job_app?for=singlestore&token=8221924
    const forParam = parsed.searchParams.get("for");
    const tokenParam = parsed.searchParams.get("token");
    if (forParam && tokenParam) {
      return { board: forParam, jobId: tokenParam };
    }
  } catch {}
  return null;
}

/**
 * Parses Ashby organization slug and job posting ID from URL.
 */
export function parseAshbyUrl(
  url: string,
): { org: string; jobId: string } | null {
  try {
    const parsed = new URL(url);
    // e.g. https://jobs.ashbyhq.com/cowboyspace/56d1d7e4-fa7e-4c25-aa8b-6828447fc64a/application
    const match = parsed.pathname.match(
      /\/([^/]+)\/([0-9a-fA-F-]+)(?:\/application)?/,
    );
    if (match && match[1] && match[2]) {
      return { org: match[1], jobId: match[2] };
    }
  } catch {}
  return null;
}

/**
 * Fetches questions for a Greenhouse job via REST API or Remix state.
 */
export async function fetchGreenhouseQuestions(
  url: string,
): Promise<{ questions: QuestionInfo[]; title?: string } | null> {
  const parsed = parseGreenhouseUrl(url);

  // 1. Try public boards-api endpoint
  if (parsed) {
    try {
      const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${parsed.board}/jobs/${parsed.jobId}?questions=true`;
      const res = await fetch(apiUrl, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.questions)) {
          const questions: QuestionInfo[] = data.questions.map((q: any) => ({
            id: String(q.id ?? ""),
            label: q.label ?? "",
            type: q.type ?? "input_text",
            required: q.required === true,
            description: q.description ?? "",
          }));
          return { questions, title: data.title };
        }
      }
    } catch {}
  }

  // 2. Fallback: Fetch page HTML and extract Remix loaderData
  try {
    const pageRes = await fetch(url);
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const match = html.match(
      /window\.__remixContext\s*=\s*(\{.*?\});\s*<\/script>/s,
    );
    if (match && match[1]) {
      const data = JSON.parse(match[1]);
      const loaderData = data.state?.loaderData || {};
      for (const val of Object.values(loaderData)) {
        const jobPost = (val as any)?.jobPost;
        if (jobPost && Array.isArray(jobPost.questions)) {
          const questions: QuestionInfo[] = jobPost.questions.map((q: any) => ({
            id: String(q.id ?? ""),
            label: q.label ?? "",
            type: q.type ?? "input_text",
            required: q.required === true,
            description: q.description ?? "",
          }));
          return { questions, title: jobPost.title };
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Fetches questions for an Ashby job via non-user GraphQL endpoint.
 */
export async function fetchAshbyQuestions(
  url: string,
): Promise<{ questions: QuestionInfo[]; title?: string } | null> {
  const parsed = parseAshbyUrl(url);
  if (!parsed) return null;

  try {
    const res = await fetch(
      "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationName: "ApiJobPosting",
          variables: {
            organizationHostedJobsPageName: parsed.org,
            jobPostingId: parsed.jobId,
          },
          query: `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
            jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
              id
              title
              applicationForm {
                sections {
                  title
                  fieldEntries {
                    id
                    field
                  }
                }
              }
            }
          }`,
        }),
      },
    );

    if (!res.ok) return null;
    const data = await res.json();
    const jobPosting = data.data?.jobPosting;
    if (!jobPosting || !jobPosting.applicationForm) return null;

    const questions: QuestionInfo[] = [];
    const sections = jobPosting.applicationForm.sections || [];
    for (const sec of sections) {
      for (const entry of sec.fieldEntries || []) {
        const f = entry.field;
        if (!f) continue;
        const label = f.title || f.humanReadablePath || "";
        const required = f.isNullable === false;
        questions.push({
          id: entry.id || f.id,
          label,
          type: f.type,
          required,
          description: f.metadata?.descriptionHtml || "",
        });
      }
    }

    return { questions, title: jobPosting.title };
  } catch {
    return null;
  }
}

/**
 * Classifies a job listing:
 * 1. Checks if ATS is Greenhouse or Ashby.
 * 2. Fetches questions for the job.
 * 3. Evaluates all questions against default job rules.
 * 4. Returns whether the job is a "default job" or must be skipped.
 */
export async function classifyJob(
  job: Pick<JobRecord, "url" | "company" | "title">,
): Promise<ClassificationResult> {
  const platform = detectPlatform(job.url);

  if (platform === "other") {
    const site = detectJobSite(job.url);
    return {
      platform: "other",
      isEligiblePlatform: false,
      isDefaultJob: false,
      reason: `Unsupported platform (${site.label}) — only Greenhouse and Ashby support auto-apply`,
    };
  }

  // Fetch questions based on platform
  let fetched: { questions: QuestionInfo[]; title?: string } | null = null;
  if (platform === "greenhouse") {
    fetched = await fetchGreenhouseQuestions(job.url);
  } else if (platform === "ashby") {
    fetched = await fetchAshbyQuestions(job.url);
  }

  if (!fetched) {
    return {
      platform,
      isEligiblePlatform: true,
      isDefaultJob: false,
      reason: "Listing closed or application form unavailable",
    };
  }

  const { questions, title } = fetched;

  // Evaluate questions
  for (const q of questions) {
    const label = q.label.trim();
    if (!label) continue;

    // Check for explicit custom question patterns (even if optional, essay questions violate default job definition)
    if (isCustomQuestion(label)) {
      return {
        platform,
        isEligiblePlatform: true,
        isDefaultJob: false,
        reason: `Custom question: "${label}"`,
        questions,
        jobTitle: title,
      };
    }

    // Required questions MUST be standard fields
    if (q.required && !isStandardQuestion(label)) {
      return {
        platform,
        isEligiblePlatform: true,
        isDefaultJob: false,
        reason: `Non-standard required field: "${label}"`,
        questions,
        jobTitle: title,
      };
    }

    // Textarea / long text fields that are required must be standard
    if (
      q.required &&
      (q.type === "textarea" || q.type === "long_text") &&
      !isStandardQuestion(label)
    ) {
      return {
        platform,
        isEligiblePlatform: true,
        isDefaultJob: false,
        reason: `Required essay/textarea field: "${label}"`,
        questions,
        jobTitle: title,
      };
    }
  }

  return {
    platform,
    isEligiblePlatform: true,
    isDefaultJob: true,
    questions,
    jobTitle: title,
  };
}
