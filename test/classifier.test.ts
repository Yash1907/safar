import { describe, it, expect } from "bun:test";
import {
  detectPlatform,
  isStandardQuestion,
  isCustomQuestion,
  parseGreenhouseUrl,
  parseAshbyUrl,
  classifyJob,
  canResolveQuestion,
} from "../src/classifier.ts";
import {
  FieldCategory,
  classifyField,
  resolveFieldValue,
} from "../src/applier/field-classifier.cjs";

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

  it("identifies signatures, dates, ITAR, and graduation date ranges", () => {
    expect(isStandardQuestion("Signature")).toBe(true);
    expect(isStandardQuestion("Electronic Signature")).toBe(true);
    expect(isStandardQuestion("Please type your full legal name to sign")).toBe(true);
    expect(isStandardQuestion("Today's Date")).toBe(true);
    expect(isStandardQuestion("Signature Date")).toBe(true);
    expect(isStandardQuestion("Are you a U.S. Person under ITAR?")).toBe(true);
    expect(isStandardQuestion("Do you expect to graduate between October 2027 and June 2028?")).toBe(true);
    expect(isStandardQuestion("What internship program are you applying for?")).toBe(true);
    expect(isStandardQuestion("When are you able to join Astranis as an intern? (12 week minimum)")).toBe(true);
    expect(isStandardQuestion("Please indicate all of the locations that you would be interested in relocating to for this position.")).toBe(true);
    expect(isStandardQuestion("Are you currently enrolled in a degree program?")).toBe(true);
    expect(isStandardQuestion("Are you currently employed by, or have you previously been employed by, Deloitte?")).toBe(true);
    expect(isStandardQuestion("Do you have any immediate family members working here?")).toBe(true);
    expect(isStandardQuestion("Have you ever been convicted of a felony?")).toBe(true);
    expect(isStandardQuestion("How did you first learn about Grow Therapy?")).toBe(true);
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

describe("Field Classifier & Answer Resolver", () => {
  const mockProfile: any = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "1234567890",
    education: {
      school: "UC Berkeley",
      degree: "Bachelor of Science",
      discipline: "Computer Science",
      startYear: 2022,
      startMonth: 9,
      graduationYear: 2026,
      graduationMonth: 5,
      gpa: "3.85",
    },
    workAuthorization: {
      authorizedInUS: true,
      requiresSponsorship: false,
      statusText: "US Citizen",
    },
    startDate: "Summer 2026",
  };

  it("classifies and resolves education fields", () => {
    const schoolRes = classifyField("What university do you attend?");
    expect(schoolRes.category).toBe(FieldCategory.EDU_SCHOOL);
    const schoolAns = resolveFieldValue(schoolRes.category, mockProfile, "intern");
    expect(schoolAns.text).toBe("UC Berkeley");

    const gpaRes = classifyField("Cumulative GPA");
    expect(gpaRes.category).toBe(FieldCategory.EDU_GPA);
    const gpaAns = resolveFieldValue(gpaRes.category, mockProfile, "intern");
    expect(gpaAns.text).toBe("3.85");

    const degRes = classifyField("Degree Level");
    expect(degRes.category).toBe(FieldCategory.EDU_DEGREE);
    const degAns = resolveFieldValue(degRes.category, mockProfile, "intern");
    expect(degAns.optionCandidates).toContain("Bachelor's Degree");
    expect(degAns.optionCandidates).toContain("Bachelor of Science");

    const startMonth = classifyField("Start date Month");
    expect(startMonth.category).toBe(FieldCategory.EDU_START_MONTH);
    expect(resolveFieldValue(startMonth.category, mockProfile, "intern").optionCandidates).toContain("September");

    const startYear = classifyField("Start date Year");
    expect(startYear.category).toBe(FieldCategory.EDU_START_YEAR);
    expect(resolveFieldValue(startYear.category, mockProfile, "intern").text).toBe("2022");

    expect(classifyField("End date Month").category).toBe(FieldCategory.EDU_GRAD_MONTH);
    expect(classifyField("End date Year").category).toBe(FieldCategory.EDU_GRAD_YEAR);
  });

  it("classifies and resolves signatures and dates", () => {
    const sigRes = classifyField("Please type your full legal name to sign");
    expect(sigRes.category).toBe(FieldCategory.SIGNATURE);
    const sigAns = resolveFieldValue(sigRes.category, mockProfile, "intern");
    expect(sigAns.text).toBe("Jane Doe");

    const dateRes = classifyField("Today's Date");
    expect(dateRes.category).toBe(FieldCategory.DATE_TODAY);
    const dateAns = resolveFieldValue(dateRes.category, mockProfile, "intern");
    expect(dateAns.text).toBe(new Date().toISOString().split("T")[0]);
  });

  it("classifies and resolves ITAR and work authorization", () => {
    const itarRes = classifyField("Are you a U.S. Person under ITAR export regulations?");
    expect(itarRes.category).toBe(FieldCategory.WORK_AUTH_ITAR);
    const itarAns = resolveFieldValue(itarRes.category, mockProfile, "intern");
    expect(itarAns.booleanVal).toBe(true);
    expect(itarAns.optionCandidates).toContain("Yes");
  });

  it("evaluates graduation date ranges accurately", () => {
    const rangeRes = classifyField("Do you expect to graduate between October 2025 and June 2027?");
    expect(rangeRes.category).toBe(FieldCategory.EDU_GRAD_RANGE);
    const rangeAns = resolveFieldValue(rangeRes.category, mockProfile, "intern", {
      label: "Do you expect to graduate between October 2025 and June 2027?",
    });
    expect(rangeAns.optionCandidates).toContain("Yes");
  });

  it("uses explicit recurring answers instead of inventing factual answers", () => {
    const profile = {
      ...mockProfile,
      answers: {
        over18: false,
        willingOnsite: false,
        previousEmployee: true,
        referralSource: "University career fair",
      },
    };

    expect(resolveFieldValue(FieldCategory.LEGAL_AGE_18, profile, "fulltime").booleanVal).toBe(false);
    expect(resolveFieldValue(FieldCategory.WORKPLACE_ONSITE, profile, "fulltime").booleanVal).toBe(false);
    expect(resolveFieldValue(FieldCategory.EMPLOYMENT_PREVIOUS, profile, "fulltime").booleanVal).toBe(true);
    expect(resolveFieldValue(FieldCategory.SOURCE_REFERRAL, profile, "fulltime").text).toBe("University career fair");
    expect(resolveFieldValue(FieldCategory.EMPLOYMENT_FELONY, mockProfile, "fulltime")).toBeNull();
  });

  it("supports profile custom-answer overrides for recurring question wording", () => {
    const profile = {
      ...mockProfile,
      customAnswers: [
        { match: "preferred programming language", answer: "TypeScript" },
        { match: "/weekends?/i", answer: false },
      ],
    };

    expect(
      resolveFieldValue(FieldCategory.UNKNOWN, profile, "fulltime", {
        label: "What is your preferred programming language?",
      }).text,
    ).toBe("TypeScript");
    expect(
      resolveFieldValue(FieldCategory.UNKNOWN, profile, "fulltime", {
        label: "Can you work weekends?",
      }).booleanVal,
    ).toBe(false);
    expect(
      canResolveQuestion(
        { label: "Why do you want to join us?", required: true, type: "textarea" },
        {
          ...mockProfile,
          customAnswers: [{ match: "why do you want to join us", answer: "Configured response" }],
        },
        "fulltime",
      ),
    ).toBe(true);
  });

  it("blocks required questions whose factual answer is absent, including education", () => {
    const felonyQuestion = {
      label: "Have you ever been convicted of a felony?",
      required: true,
      type: "radio",
    };
    expect(canResolveQuestion(felonyQuestion, mockProfile, "fulltime")).toBe(false);
    expect(
      canResolveQuestion(
        felonyQuestion,
        { ...mockProfile, answers: { felonyConviction: false } },
        "fulltime",
      ),
    ).toBe(true);

    expect(
      canResolveQuestion(
        { label: "Graduation year", required: true, type: "select" },
        { ...mockProfile, education: { ...mockProfile.education, graduationYear: undefined } },
        "intern",
      ),
    ).toBe(false);
  });
});
