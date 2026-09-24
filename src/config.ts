import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import type { RoleType } from "./role.ts";
export type { RoleType } from "./role.ts";

export interface RepoSourceConfig {
  id: string;
  displayName: string;
  owner: string;
  repo: string;
  branch?: string;
  enabled?: boolean; // default true
}

export interface SheetsConfig {
  enabled: boolean;
  spreadsheetId: string;
  sheetName: string;
  serviceAccountKeyPath: string;
}

export interface DiscordConfig {
  webhookUrl: string;
  eodSummaryTime?: string; // e.g. "18:00" (default: "18:00")
}

export interface EducationConfig {
  school: string;
  degree?: string; // e.g. "Bachelor of Science"
  discipline?: string; // e.g. "Computer Science"
  graduationYear?: number; // e.g. 2026
  graduationMonth?: number | string; // 1-12, "05", or "May"
  gpa?: string; // e.g. "3.8"
}

export interface DemographicsConfig {
  gender?: string; // default "Decline to Self-Identify"
  race?: string; // default "Decline to Self-Identify"
  veteran?: string; // default "Decline to Self-Identify"
  disability?: string; // default "Decline to Self-Identify"
}

export interface WorkAuthorizationConfig {
  authorizedInUS?: boolean; // default true
  requiresSponsorship?: boolean; // default false
  willingToRelocate?: boolean; // default true
  statusText?: string; // e.g. "US Citizen", "Permanent Resident", or custom right-to-work text
}

export interface RoleProfileOverride {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  resumePath?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  githubOnlyIfRequired?: boolean;
  portfolioUrl?: string;
  willingToRelocate?: boolean;
  startDate?: string; // e.g. "Immediately", "May 2026", "Summer 2026"
  desiredSalary?: string | number; // e.g. "Negotiable", "$120,000", or 120000
  address?: {
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  education?: Partial<EducationConfig>;
  workAuthorization?: WorkAuthorizationConfig;
  demographics?: DemographicsConfig;
}

export interface ProfileConfig {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  resumePath: string;
  linkedinUrl?: string;
  githubUrl?: string;
  githubOnlyIfRequired?: boolean; // if true, only supplies GitHub when field is required
  portfolioUrl?: string;
  willingToRelocate?: boolean; // default true
  startDate?: string; // e.g. "Immediately", "May 2026", "Summer 2026"
  desiredSalary?: string | number; // e.g. "Negotiable", "$120,000", or 120000
  address?: {
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  education?: EducationConfig;
  workAuthorization?: WorkAuthorizationConfig;
  demographics?: DemographicsConfig;

  /** Overrides used when applying to internship roles */
  intern?: RoleProfileOverride;
  /** Overrides used when applying to full-time roles */
  fulltime?: RoleProfileOverride;
  /** Alias for fulltime */
  ft?: RoleProfileOverride;
}

export interface AutoApplyConfig {
  enabled?: boolean; // default true
  lookbackDays?: number; // default 3
  dryRun?: boolean; // default false
  headless?: boolean; // default true (false runs headed browser so you can watch)
}

export interface SafarConfig {
  sources: {
    simplify: RepoSourceConfig[];
    jobright: RepoSourceConfig[];
    zapply: RepoSourceConfig[];
  };
  /** One-way push of tracked jobs to Google Sheets (§ "sync ... with google sheets"). null = not configured. */
  sheets: SheetsConfig | null;
  /** Discord webhook notifications for auto-applied jobs and daily summary. null = not configured. */
  discord: DiscordConfig | null;
  /** Profile details used by auto-applier for Greenhouse and Ashby forms. null = not configured. */
  profile: ProfileConfig | null;
  /** Auto-applier runtime settings. */
  autoApply: AutoApplyConfig;
}

/**
 * §5 M4: defaults match §1 — SimplifyJobs New-Grad-Positions always on,
 * Summer2026-Internships available but off by default ("optionally" — §1.1),
 * jobright's 2026 SWE New Grad repo on by default, and zapplyjobs 2027 New Grad
 * and Internships repos on by default.
 */
export function defaultConfig(): SafarConfig {
  return {
    sources: {
      simplify: [
        {
          id: "simplify-newgrad",
          displayName: "SimplifyJobs New Grad",
          owner: "SimplifyJobs",
          repo: "New-Grad-Positions",
          branch: "dev",
          enabled: true,
        },
        {
          id: "simplify-summer2026",
          displayName: "SimplifyJobs Summer Internships 2026",
          owner: "SimplifyJobs",
          repo: "Summer2026-Internships",
          branch: "dev",
          enabled: false,
        },
      ],
      jobright: [
        {
          id: "jobright-swe-2026",
          displayName: "jobright SWE New Grad 2026",
          owner: "jobright-ai",
          repo: "2026-Software-Engineer-New-Grad",
          branch: "master",
          enabled: true,
        },
      ],
      zapply: [
        {
          id: "zapply-newgrad-2027",
          displayName: "Zapply New Grad 2027",
          owner: "zapplyjobs",
          repo: "New-Grad-Jobs-2027",
          branch: "main",
          enabled: true,
        },
        {
          id: "zapply-internships-2027",
          displayName: "Zapply Internships 2027",
          owner: "zapplyjobs",
          repo: "Internships-2027",
          branch: "main",
          enabled: true,
        },
      ],
    },
    sheets: null,
    discord: null,
    profile: null,
    autoApply: {
      enabled: true,
      lookbackDays: 3,
      dryRun: false,
      headless: true,
    },
  };
}

export function resolveConfigPath(): string {
  if (process.env.SAFAR_CONFIG) {
    return process.env.SAFAR_CONFIG;
  }
  const localPath = join(process.cwd(), "config.json");
  if (existsSync(localPath)) {
    return localPath;
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    const winPath = join(process.env.APPDATA, "safar", "config.json");
    if (existsSync(winPath)) {
      return winPath;
    }
  }
  return join(homedir(), ".config", "safar", "config.json");
}

function parseSheetsConfig(raw: unknown): SheetsConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.spreadsheetId !== "string" || typeof r.serviceAccountKeyPath !== "string") {
    return null;
  }
  return {
    enabled: r.enabled !== false,
    spreadsheetId: r.spreadsheetId,
    sheetName: typeof r.sheetName === "string" ? r.sheetName : "Tracker",
    serviceAccountKeyPath: r.serviceAccountKeyPath,
  };
}

function parseDiscordConfig(raw: unknown): DiscordConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.webhookUrl !== "string" || !r.webhookUrl.trim()) return null;
  return {
    webhookUrl: r.webhookUrl.trim(),
    eodSummaryTime: typeof r.eodSummaryTime === "string" ? r.eodSummaryTime.trim() : "18:00",
  };
}

function parseRoleProfileOverride(raw: unknown): RoleProfileOverride | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, any>;
  const override: RoleProfileOverride = {};

  if (typeof r.firstName === "string" && r.firstName.trim()) override.firstName = r.firstName.trim();
  if (typeof r.lastName === "string" && r.lastName.trim()) override.lastName = r.lastName.trim();
  if (typeof r.email === "string" && r.email.trim()) override.email = r.email.trim();
  if (typeof r.phone === "string" && r.phone.trim()) override.phone = r.phone.trim();
  if (typeof r.resumePath === "string" && r.resumePath.trim()) override.resumePath = r.resumePath.trim();
  if (typeof r.linkedinUrl === "string") override.linkedinUrl = r.linkedinUrl.trim();
  if (typeof r.githubUrl === "string") override.githubUrl = r.githubUrl.trim();
  if (typeof r.githubOnlyIfRequired === "boolean") override.githubOnlyIfRequired = r.githubOnlyIfRequired;
  if (typeof r.portfolioUrl === "string") override.portfolioUrl = r.portfolioUrl.trim();
  if (typeof r.willingToRelocate === "boolean") override.willingToRelocate = r.willingToRelocate;
  if (typeof r.startDate === "string" && r.startDate.trim()) override.startDate = r.startDate.trim();
  if (typeof r.desiredSalary === "string" || typeof r.desiredSalary === "number") override.desiredSalary = r.desiredSalary;

  if (r.address && typeof r.address === "object") {
    override.address = {
      city: typeof r.address.city === "string" ? r.address.city.trim() : undefined,
      state: typeof r.address.state === "string" ? r.address.state.trim() : undefined,
      country: typeof r.address.country === "string" ? r.address.country.trim() : undefined,
      postalCode:
        typeof r.address.postalCode === "string"
          ? r.address.postalCode.trim()
          : undefined,
    };
  }

  if (r.education && typeof r.education === "object") {
    override.education = {
      school: typeof r.education.school === "string" ? r.education.school.trim() : undefined,
      degree: typeof r.education.degree === "string" ? r.education.degree.trim() : undefined,
      discipline:
        typeof r.education.discipline === "string"
          ? r.education.discipline.trim()
          : undefined,
      graduationYear:
        typeof r.education.graduationYear === "number"
          ? r.education.graduationYear
          : undefined,
      graduationMonth:
        typeof r.education.graduationMonth === "number" || typeof r.education.graduationMonth === "string"
          ? r.education.graduationMonth
          : undefined,
      gpa: r.education.gpa ? String(r.education.gpa).trim() : undefined,
    };
  }

  if (r.workAuthorization && typeof r.workAuthorization === "object") {
    override.workAuthorization = {
      authorizedInUS:
        typeof r.workAuthorization.authorizedInUS === "boolean"
          ? r.workAuthorization.authorizedInUS
          : undefined,
      requiresSponsorship:
        typeof r.workAuthorization.requiresSponsorship === "boolean"
          ? r.workAuthorization.requiresSponsorship
          : undefined,
      willingToRelocate:
        typeof r.workAuthorization.willingToRelocate === "boolean"
          ? r.workAuthorization.willingToRelocate
          : undefined,
      statusText:
        typeof r.workAuthorization.statusText === "string"
          ? r.workAuthorization.statusText.trim()
          : undefined,
    };
  }

  if (r.demographics && typeof r.demographics === "object") {
    override.demographics = {
      gender: r.demographics.gender,
      race: r.demographics.race,
      veteran: r.demographics.veteran,
      disability: r.demographics.disability,
    };
  }

  return override;
}

function parseProfileConfig(raw: unknown): ProfileConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  if (
    typeof r.firstName !== "string" ||
    typeof r.lastName !== "string" ||
    typeof r.email !== "string"
  ) {
    return null;
  }

  const internRaw = r.intern ?? r.profiles?.intern;
  const ftRaw = r.fulltime ?? r.ft ?? r.profiles?.fulltime ?? r.profiles?.ft;
  const internOverride = parseRoleProfileOverride(internRaw);
  const ftOverride = parseRoleProfileOverride(ftRaw);

  return {
    firstName: r.firstName.trim(),
    lastName: r.lastName.trim(),
    email: r.email.trim(),
    phone: typeof r.phone === "string" ? r.phone.trim() : "",
    resumePath: typeof r.resumePath === "string" ? r.resumePath.trim() : "",
    linkedinUrl: typeof r.linkedinUrl === "string" ? r.linkedinUrl.trim() : undefined,
    githubUrl: typeof r.githubUrl === "string" ? r.githubUrl.trim() : undefined,
    githubOnlyIfRequired: r.githubOnlyIfRequired === true,
    portfolioUrl: typeof r.portfolioUrl === "string" ? r.portfolioUrl.trim() : undefined,
    willingToRelocate:
      typeof r.willingToRelocate === "boolean"
        ? r.willingToRelocate
        : r.workAuthorization?.willingToRelocate !== false,
    startDate: typeof r.startDate === "string" ? r.startDate.trim() : undefined,
    desiredSalary: typeof r.desiredSalary === "string" || typeof r.desiredSalary === "number" ? r.desiredSalary : undefined,
    address:
      r.address && typeof r.address === "object"
        ? {
            city: typeof r.address.city === "string" ? r.address.city.trim() : undefined,
            state: typeof r.address.state === "string" ? r.address.state.trim() : undefined,
            country: typeof r.address.country === "string" ? r.address.country.trim() : undefined,
            postalCode:
              typeof r.address.postalCode === "string"
                ? r.address.postalCode.trim()
                : undefined,
          }
        : undefined,
    education:
      r.education && typeof r.education === "object"
        ? {
            school: String(r.education.school || "").trim(),
            degree: typeof r.education.degree === "string" ? r.education.degree.trim() : undefined,
            discipline:
              typeof r.education.discipline === "string"
                ? r.education.discipline.trim()
                : undefined,
            graduationYear:
              typeof r.education.graduationYear === "number"
                ? r.education.graduationYear
                : undefined,
            graduationMonth:
              typeof r.education.graduationMonth === "number" || typeof r.education.graduationMonth === "string"
                ? r.education.graduationMonth
                : undefined,
            gpa: r.education.gpa ? String(r.education.gpa).trim() : undefined,
          }
        : undefined,
    workAuthorization:
      r.workAuthorization && typeof r.workAuthorization === "object"
        ? {
            authorizedInUS: r.workAuthorization.authorizedInUS !== false,
            requiresSponsorship: r.workAuthorization.requiresSponsorship === true,
            willingToRelocate: r.workAuthorization.willingToRelocate !== false,
            statusText:
              typeof r.workAuthorization.statusText === "string"
                ? r.workAuthorization.statusText.trim()
                : undefined,
          }
        : { authorizedInUS: true, requiresSponsorship: false, willingToRelocate: true },
    demographics:
      r.demographics && typeof r.demographics === "object"
        ? {
            gender: r.demographics.gender || "Decline to Self-Identify",
            race: r.demographics.race || "Decline to Self-Identify",
            veteran: r.demographics.veteran || "Decline to Self-Identify",
            disability: r.demographics.disability || "Decline to Self-Identify",
          }
        : undefined,
    intern: internOverride,
    fulltime: ftOverride,
    ft: ftOverride,
  };
}

/**
 * Merges a base ProfileConfig with any role-specific overrides (intern vs fulltime/ft).
 * If no role overrides exist, returns the base profile untouched.
 */
export function resolveProfileForRole(
  profile: ProfileConfig | null,
  roleType: RoleType,
): ProfileConfig | null {
  if (!profile) return null;

  const override =
    roleType === "intern"
      ? profile.intern
      : (profile.fulltime ?? profile.ft);

  if (!override) {
    return profile;
  }

  const willingToRelocate =
    override.willingToRelocate !== undefined
      ? override.willingToRelocate
      : (override.workAuthorization?.willingToRelocate !== undefined
          ? override.workAuthorization.willingToRelocate
          : (profile.willingToRelocate ?? profile.workAuthorization?.willingToRelocate ?? true));

  return {
    ...profile,
    firstName: override.firstName ?? profile.firstName,
    lastName: override.lastName ?? profile.lastName,
    email: override.email ?? profile.email,
    phone: override.phone ?? profile.phone,
    resumePath: override.resumePath ?? profile.resumePath,
    linkedinUrl: override.linkedinUrl !== undefined ? override.linkedinUrl : profile.linkedinUrl,
    githubUrl: override.githubUrl !== undefined ? override.githubUrl : profile.githubUrl,
    githubOnlyIfRequired:
      override.githubOnlyIfRequired !== undefined
        ? override.githubOnlyIfRequired
        : profile.githubOnlyIfRequired,
    portfolioUrl: override.portfolioUrl !== undefined ? override.portfolioUrl : profile.portfolioUrl,
    willingToRelocate,
    startDate: override.startDate !== undefined ? override.startDate : profile.startDate,
    desiredSalary: override.desiredSalary !== undefined ? override.desiredSalary : profile.desiredSalary,
    address: override.address
      ? { ...profile.address, ...override.address }
      : profile.address,
    education: override.education
      ? {
          school: override.education.school ?? profile.education?.school ?? "",
          degree: override.education.degree ?? profile.education?.degree,
          discipline: override.education.discipline ?? profile.education?.discipline,
          graduationYear:
            override.education.graduationYear !== undefined
              ? override.education.graduationYear
              : profile.education?.graduationYear,
          graduationMonth:
            override.education.graduationMonth !== undefined
              ? override.education.graduationMonth
              : profile.education?.graduationMonth,
          gpa: override.education.gpa ?? profile.education?.gpa,
        }
      : profile.education,
    workAuthorization: override.workAuthorization
      ? {
          authorizedInUS:
            override.workAuthorization.authorizedInUS !== undefined
              ? override.workAuthorization.authorizedInUS
              : (profile.workAuthorization?.authorizedInUS ?? true),
          requiresSponsorship:
            override.workAuthorization.requiresSponsorship !== undefined
              ? override.workAuthorization.requiresSponsorship
              : (profile.workAuthorization?.requiresSponsorship ?? false),
          willingToRelocate,
          statusText:
            override.workAuthorization.statusText !== undefined
              ? override.workAuthorization.statusText
              : profile.workAuthorization?.statusText,
        }
      : (profile.workAuthorization
          ? { ...profile.workAuthorization, willingToRelocate }
          : { authorizedInUS: true, requiresSponsorship: false, willingToRelocate }),
    demographics: override.demographics
      ? { ...profile.demographics, ...override.demographics }
      : profile.demographics,
    intern: profile.intern,
    fulltime: profile.fulltime,
    ft: profile.ft,
  };
}

function parseAutoApplyConfig(raw: unknown): AutoApplyConfig {
  if (!raw || typeof raw !== "object") {
    return { enabled: true, lookbackDays: 3, dryRun: false, headless: true };
  }
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled !== false,
    lookbackDays: typeof r.lookbackDays === "number" ? r.lookbackDays : 3,
    dryRun: r.dryRun === true,
    headless: r.headless !== false,
  };
}

/**
 * Loads ~/.config/safar/config.json. Missing file → defaults, silently.
 * Malformed file → defaults, with a warning (defensive parsing, same
 * philosophy as the jobright adapter — a bad config shouldn't crash the app).
 */
export function loadConfig(path: string = resolveConfigPath()): SafarConfig {
  if (!existsSync(path)) return defaultConfig();

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    const defaults = defaultConfig();
    return {
      sources: {
        simplify: Array.isArray(parsed?.sources?.simplify)
          ? parsed.sources.simplify
          : defaults.sources.simplify,
        jobright: Array.isArray(parsed?.sources?.jobright)
          ? parsed.sources.jobright
          : defaults.sources.jobright,
        zapply: Array.isArray(parsed?.sources?.zapply)
          ? parsed.sources.zapply
          : defaults.sources.zapply,
      },
      sheets: parseSheetsConfig(parsed?.sheets),
      discord: parseDiscordConfig(parsed?.discord),
      profile: parseProfileConfig(parsed?.profile),
      autoApply: parseAutoApplyConfig(parsed?.autoApply),
    };
  } catch (err) {
    console.warn(
      `safar: couldn't parse ${path} (${err instanceof Error ? err.message : err}) — using defaults`,
    );
    return defaultConfig();
  }
}
