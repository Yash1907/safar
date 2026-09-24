import { describe, it, expect } from "bun:test";
import { detectRoleType, formatRoleType, roleBadge } from "../src/role.ts";
import { resolveProfileForRole, type ProfileConfig } from "../src/config.ts";

describe("role detection", () => {
  it("detects internship and co-op keywords in titles", () => {
    expect(detectRoleType({ title: "Software Engineer Intern" })).toBe("intern");
    expect(detectRoleType({ title: "Summer 2026 SWE Internship" })).toBe("intern");
    expect(detectRoleType({ title: "Backend Engineering Co-op" })).toBe("intern");
    expect(detectRoleType({ title: "Frontend Coop Student" })).toBe("intern");
    expect(detectRoleType({ title: "AI Research Fellow" })).toBe("intern");
    expect(detectRoleType({ title: "Software Developer Apprentice" })).toBe("intern");
    expect(detectRoleType({ title: "Student Researcher - ML" })).toBe("intern");
  });

  it("does not false-positive on words containing 'intern' like Internal or International", () => {
    expect(detectRoleType({ title: "Software Engineer - Internal Tools" })).toBe("fulltime");
    expect(detectRoleType({ title: "International Expansion Lead" })).toBe("fulltime");
    expect(detectRoleType({ title: "Internet of Things Engineer" })).toBe("fulltime");
    expect(detectRoleType({ title: "Platform Engineer (Internal Systems)" })).toBe("fulltime");
  });

  it("detects full-time and new grad keywords in titles", () => {
    expect(detectRoleType({ title: "2026 SWE New Grad" })).toBe("fulltime");
    expect(detectRoleType({ title: "Full-Time Software Engineer" })).toBe("fulltime");
    expect(detectRoleType({ title: "Entry-Level Systems Developer" })).toBe("fulltime");
    expect(detectRoleType({ title: "Software Engineer - University Graduate" })).toBe("fulltime");
    expect(detectRoleType({ title: "Associate Frontend Developer (FT)" })).toBe("fulltime");
  });

  it("uses sourceId as fallback when title is generic", () => {
    expect(
      detectRoleType({ title: "Software Engineer", sourceId: "simplify-summer2026" }),
    ).toBe("intern");
    expect(
      detectRoleType({ title: "Software Engineer", sourceId: "zapply-internships-2027" }),
    ).toBe("intern");
    expect(
      detectRoleType({ title: "Software Engineer", sourceId: "jobright-swe-2026" }),
    ).toBe("fulltime");
    expect(
      detectRoleType({ title: "Software Engineer", sourceId: "simplify-newgrad" }),
    ).toBe("fulltime");
  });

  it("uses extra metadata if available", () => {
    expect(
      detectRoleType({
        title: "Software Engineer",
        extra: { type: "Summer Internship 2026" },
      }),
    ).toBe("intern");
  });

  it("formats role type and badges correctly", () => {
    expect(formatRoleType("intern")).toBe("Internship");
    expect(formatRoleType("fulltime")).toBe("Full-Time");
    expect(roleBadge("intern")).toBe("intern");
    expect(roleBadge("fulltime")).toBe("ft");
  });
});

describe("profile resolution for roles", () => {
  const baseProfile: ProfileConfig = {
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    phone: "123-456-7890",
    resumePath: "/resumes/general.pdf",
    linkedinUrl: "https://linkedin.com/in/johndoe",
    education: {
      school: "UC Berkeley",
      degree: "B.S.",
      discipline: "Computer Science",
      graduationYear: 2026,
      graduationMonth: 5,
      gpa: "3.9",
    },
    workAuthorization: {
      authorizedInUS: true,
      requiresSponsorship: false,
    },
    intern: {
      resumePath: "/resumes/intern_resume.pdf",
      education: {
        graduationYear: 2027,
      },
    },
    fulltime: {
      resumePath: "/resumes/fulltime_resume.pdf",
      education: {
        graduationYear: 2026,
      },
    },
  };

  it("returns null if profile is null", () => {
    expect(resolveProfileForRole(null, "intern")).toBeNull();
    expect(resolveProfileForRole(null, "fulltime")).toBeNull();
  });

  it("returns base profile if no overrides are defined", () => {
    const simpleProfile: ProfileConfig = {
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      phone: "555-5555",
      resumePath: "/resumes/default.pdf",
    };
    const resolved = resolveProfileForRole(simpleProfile, "intern");
    expect(resolved).toEqual(simpleProfile);
  });

  it("resolves intern profile with intern overrides", () => {
    const resolved = resolveProfileForRole(baseProfile, "intern");
    expect(resolved).not.toBeNull();
    expect(resolved?.firstName).toBe("John");
    expect(resolved?.email).toBe("john@example.com");
    // Overridden resume and graduation year
    expect(resolved?.resumePath).toBe("/resumes/intern_resume.pdf");
    expect(resolved?.education?.graduationYear).toBe(2027);
    // Preserved education school and GPA
    expect(resolved?.education?.school).toBe("UC Berkeley");
    expect(resolved?.education?.gpa).toBe("3.9");
  });

  it("resolves full-time profile with full-time overrides", () => {
    const resolved = resolveProfileForRole(baseProfile, "fulltime");
    expect(resolved).not.toBeNull();
    expect(resolved?.firstName).toBe("John");
    // Overridden resume and graduation year
    expect(resolved?.resumePath).toBe("/resumes/fulltime_resume.pdf");
    expect(resolved?.education?.graduationYear).toBe(2026);
    expect(resolved?.education?.school).toBe("UC Berkeley");
  });

  it("supports ft alias for fulltime override", () => {
    const ftProfile: ProfileConfig = {
      firstName: "Alex",
      lastName: "Taylor",
      email: "alex@example.com",
      phone: "111-2222",
      resumePath: "/resumes/base.pdf",
      ft: {
        resumePath: "/resumes/ft_only.pdf",
      },
    };
    const resolved = resolveProfileForRole(ftProfile, "fulltime");
    expect(resolved?.resumePath).toBe("/resumes/ft_only.pdf");
  });

  it("supports graduationMonth as string or number per role", () => {
    const multiMonthProfile: ProfileConfig = {
      firstName: "Taylor",
      lastName: "Swift",
      email: "taylor@example.com",
      phone: "555-0199",
      resumePath: "/resumes/base.pdf",
      education: {
        school: "NYU",
        graduationYear: 2026,
        graduationMonth: "May",
      },
      intern: {
        education: {
          graduationYear: 2027,
          graduationMonth: "December",
        },
      },
      fulltime: {
        education: {
          graduationYear: 2026,
          graduationMonth: 5,
        },
      },
    };

    const internResolved = resolveProfileForRole(multiMonthProfile, "intern");
    expect(internResolved?.education?.graduationMonth).toBe("December");
    expect(internResolved?.education?.graduationYear).toBe(2027);

    const ftResolved = resolveProfileForRole(multiMonthProfile, "fulltime");
    expect(ftResolved?.education?.graduationMonth).toBe(5);
    expect(ftResolved?.education?.graduationYear).toBe(2026);
  });

  it("supports githubOnlyIfRequired and willingToRelocate overrides", () => {
    const profileWithPrefs: ProfileConfig = {
      firstName: "Morgan",
      lastName: "Lee",
      email: "morgan@example.com",
      phone: "555-9988",
      resumePath: "/resumes/base.pdf",
      githubUrl: "https://github.com/morgan",
      githubOnlyIfRequired: true,
      willingToRelocate: true,
      fulltime: {
        willingToRelocate: false,
      },
    };

    const internResolved = resolveProfileForRole(profileWithPrefs, "intern");
    expect(internResolved?.githubOnlyIfRequired).toBe(true);
    expect(internResolved?.willingToRelocate).toBe(true);

    const ftResolved = resolveProfileForRole(profileWithPrefs, "fulltime");
    expect(ftResolved?.githubOnlyIfRequired).toBe(true);
    expect(ftResolved?.willingToRelocate).toBe(false);
  });

  it("supports startDate and desiredSalary overrides", () => {
    const profileWithStartAndSalary: ProfileConfig = {
      firstName: "Taylor",
      lastName: "Swift",
      email: "taylor@example.com",
      phone: "555-1313",
      resumePath: "/resumes/base.pdf",
      startDate: "Immediately",
      desiredSalary: "Negotiable",
      intern: {
        startDate: "Summer 2026",
        desiredSalary: 55,
      },
      fulltime: {
        startDate: "June 2026",
        desiredSalary: 130000,
      },
    };

    const internResolved = resolveProfileForRole(profileWithStartAndSalary, "intern");
    expect(internResolved?.startDate).toBe("Summer 2026");
    expect(internResolved?.desiredSalary).toBe(55);

    const ftResolved = resolveProfileForRole(profileWithStartAndSalary, "fulltime");
    expect(ftResolved?.startDate).toBe("June 2026");
    expect(ftResolved?.desiredSalary).toBe(130000);
  });
});
