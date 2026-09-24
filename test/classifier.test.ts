import { describe, it, expect } from "bun:test";
import {
  detectPlatform,
  isStandardQuestion,
  isCustomQuestion,
  parseGreenhouseUrl,
  parseAshbyUrl,
  classifyJob,
} from "../src/classifier.ts";

describe("detectPlatform", () => {
  it("identifies greenhouse URLs", () => {
    expect(detectPlatform("https://boards.greenhouse.io/stripe/jobs/12345")).toBe("greenhouse");
    expect(detectPlatform("https://job-boards.greenhouse.io/singlestore/jobs/8221924")).toBe("greenhouse");
    expect(detectPlatform("https://boards.greenhouse.io/embed/job_app?for=oklo&token=5739861004")).toBe("greenhouse");
  });

  it("identifies ashby URLs", () => {
    expect(detectPlatform("https://jobs.ashbyhq.com/mechanize/1ef28bb2-6251-4da6-a590-a4a7606368cb")).toBe("ashby");
    expect(detectPlatform("https://jobs.ashbyhq.com/cowboyspace/56d1d7e4-fa7e-4c25-aa8b-6828447fc64a/application?embed=true")).toBe("ashby");
  });

  it("returns other for non-greenhouse and non-ashby URLs", () => {
    expect(detectPlatform("https://att.wd1.myworkdayjobs.com/job/123")).toBe("other");
    expect(detectPlatform("https://jobs.lever.co/company/abc")).toBe("other");
    expect(detectPlatform("https://careers.rivian.com/jobs/33803")).toBe("other");
  });
});

describe("parseGreenhouseUrl", () => {
  it("extracts board and jobId from standard greenhouse path", () => {
    const res = parseGreenhouseUrl("https://job-boards.greenhouse.io/singlestore/jobs/8221924");
    expect(res).toEqual({ board: "singlestore", jobId: "8221924" });
  });

  it("extracts board and jobId from query parameters", () => {
    const res = parseGreenhouseUrl("https://boards.greenhouse.io/embed/job_app?for=singlestore&token=8221924");
    expect(res).toEqual({ board: "singlestore", jobId: "8221924" });
  });

  it("returns null for non-greenhouse or invalid URLs", () => {
    expect(parseGreenhouseUrl("https://example.com/jobs/123")).toBeNull();
  });
});

describe("parseAshbyUrl", () => {
  it("extracts org and jobId from ashby application path", () => {
    const res = parseAshbyUrl("https://jobs.ashbyhq.com/cowboyspace/56d1d7e4-fa7e-4c25-aa8b-6828447fc64a/application");
    expect(res).toEqual({ org: "cowboyspace", jobId: "56d1d7e4-fa7e-4c25-aa8b-6828447fc64a" });
  });

  it("extracts org and jobId from ashby posting path without /application", () => {
    const res = parseAshbyUrl("https://jobs.ashbyhq.com/mechanize/1ef28bb2-6251-4da6-a590-a4a7606368cb");
    expect(res).toEqual({ org: "mechanize", jobId: "1ef28bb2-6251-4da6-a590-a4a7606368cb" });
  });
});

describe("isStandardQuestion", () => {
  it("identifies contact and personal information fields", () => {
    expect(isStandardQuestion("First Name")).toBe(true);
    expect(isStandardQuestion("Last Name")).toBe(true);
    expect(isStandardQuestion("Name")).toBe(true);
    expect(isStandardQuestion("Email")).toBe(true);
    expect(isStandardQuestion("Phone")).toBe(true);
    expect(isStandardQuestion("Candidate Location")).toBe(true);
  });

  it("identifies resume and document fields", () => {
    expect(isStandardQuestion("Resume/CV")).toBe(true);
    expect(isStandardQuestion("Cover Letter")).toBe(true);
  });

  it("identifies school and education fields", () => {
    expect(isStandardQuestion("School / University")).toBe(true);
    expect(isStandardQuestion("Degree")).toBe(true);
    expect(isStandardQuestion("Discipline / Major")).toBe(true);
    expect(isStandardQuestion("Graduation Date")).toBe(true);
    expect(isStandardQuestion("GPA")).toBe(true);
  });

  it("identifies work authorization and EEO fields", () => {
    expect(isStandardQuestion("Are you legally authorized to work in the United States?")).toBe(true);
    expect(isStandardQuestion("Will you now or in the future require visa sponsorship?")).toBe(true);
    expect(isStandardQuestion("Do you have the legal right to work in the USA?")).toBe(true);
    expect(isStandardQuestion("Do you have legal rights to work in the USA?")).toBe(true);
    expect(isStandardQuestion("Please provide your right to work status")).toBe(true);
    expect(isStandardQuestion("Are you currently eligible to work in the United States?")).toBe(true);
    expect(isStandardQuestion("Voluntary Self-Identification of Disability")).toBe(true);
    expect(isStandardQuestion("Gender")).toBe(true);
    expect(isStandardQuestion("Veteran Status")).toBe(true);
  });

  it("identifies general standard questions like legal name, location, commute, availability, and age", () => {
    expect(isStandardQuestion("Have you added your full legal name and surname (including any middle names)?")).toBe(true);
    expect(isStandardQuestion("How did you hear about this role?")).toBe(true);
    expect(isStandardQuestion("How did you connect with us?")).toBe(true);
    expect(isStandardQuestion("Where are you currently located?")).toBe(true);
    expect(isStandardQuestion("When is your earliest avaiablity to start in a full-time role?")).toBe(true);
    expect(isStandardQuestion("Are you at least 18 years old?")).toBe(true);
    expect(isStandardQuestion("Are you willing and able to work out of our Boston office 5 days per week?")).toBe(true);
    expect(isStandardQuestion("If you selected \"Other\", please specify below")).toBe(true);
    expect(isStandardQuestion("What is your desired salary?")).toBe(true);
  });
});

describe("isCustomQuestion", () => {
  it("identifies 'why this job / why us' questions", () => {
    expect(isCustomQuestion("Why do you want to work at Stripe?")).toBe(true);
    expect(isCustomQuestion("Why this role?")).toBe(true);
    expect(isCustomQuestion("Why are you looking to join our company?")).toBe(true);
  });

  it("identifies 'hardest challenge / projects' questions", () => {
    expect(isCustomQuestion("What is the hardest challenge you've faced?")).toBe(true);
    expect(isCustomQuestion("Describe a technical challenge you solved")).toBe(true);
    expect(isCustomQuestion("Tell us about a time you led a team project")).toBe(true);
    expect(isCustomQuestion("What is your proudest accomplishment?")).toBe(true);
    expect(isCustomQuestion("Please share 3-5 sentences explaining your interest in the Blockchain/Web3 industry.")).toBe(true);
  });

  it("returns false for standard fields", () => {
    expect(isCustomQuestion("First Name")).toBe(false);
    expect(isCustomQuestion("Resume/CV")).toBe(false);
    expect(isCustomQuestion("School")).toBe(false);
    expect(isCustomQuestion("LinkedIn Profile")).toBe(false);
    expect(isCustomQuestion("Are you authorized to work in the US?")).toBe(false);
    expect(isCustomQuestion("Do you have the legal right to work in the USA?")).toBe(false);
    expect(isCustomQuestion("Have you added your full legal name and surname (including any middle names)?")).toBe(false);
  });
});

describe("classifyJob", () => {
  it("rejects non-Greenhouse and non-Ashby jobs immediately", async () => {
    const res = await classifyJob({
      url: "https://myworkdayjobs.com/company/job/123",
      company: "Acme",
      title: "SWE",
    });
    expect(res.isDefaultJob).toBe(false);
    expect(res.isEligiblePlatform).toBe(false);
    expect(res.reason).toContain("Unsupported platform");
  });
});
