/**
 * Field Classifier and Answer Resolver for Greenhouse & Ashby job applications.
 *
 * Categorizes question prompts, labels, and form fields into semantic intents
 * and resolves exact answers, dropdown candidates, and boolean values from
 * the candidate profile.
 */

const FieldCategory = {
  // Contact & Personal
  CONTACT_FIRST_NAME: "CONTACT_FIRST_NAME",
  CONTACT_PREFERRED_NAME: "CONTACT_PREFERRED_NAME",
  CONTACT_LAST_NAME: "CONTACT_LAST_NAME",
  CONTACT_FULL_NAME: "CONTACT_FULL_NAME",
  CONTACT_EMAIL: "CONTACT_EMAIL",
  CONTACT_PHONE: "CONTACT_PHONE",
  CONTACT_LOCATION: "CONTACT_LOCATION",
  CONTACT_ADDRESS: "CONTACT_ADDRESS",
  CONTACT_CITY: "CONTACT_CITY",
  CONTACT_STATE: "CONTACT_STATE",
  CONTACT_POSTAL: "CONTACT_POSTAL",
  CONTACT_COUNTRY: "CONTACT_COUNTRY",

  // Documents & Links
  DOC_RESUME: "DOC_RESUME",
  DOC_COVER_LETTER: "DOC_COVER_LETTER",
  LINK_LINKEDIN: "LINK_LINKEDIN",
  LINK_GITHUB: "LINK_GITHUB",
  LINK_PORTFOLIO: "LINK_PORTFOLIO",
  LINK_WEBSITE: "LINK_WEBSITE",
  LINK_TWITTER: "LINK_TWITTER",

  // Education / Academic
  EDU_SCHOOL: "EDU_SCHOOL",
  EDU_DEGREE: "EDU_DEGREE",
  EDU_MAJOR: "EDU_MAJOR",
  EDU_GPA: "EDU_GPA",
  EDU_START_YEAR: "EDU_START_YEAR",
  EDU_START_MONTH: "EDU_START_MONTH",
  EDU_GRAD_YEAR: "EDU_GRAD_YEAR",
  EDU_GRAD_MONTH: "EDU_GRAD_MONTH",
  EDU_GRAD_DATE: "EDU_GRAD_DATE",
  EDU_GRAD_RANGE: "EDU_GRAD_RANGE",
  EDU_CURRENT_STUDENT: "EDU_CURRENT_STUDENT",

  // Work Authorization & Legal
  WORK_AUTH_US: "WORK_AUTH_US",
  WORK_AUTH_SPONSORSHIP: "WORK_AUTH_SPONSORSHIP",
  WORK_AUTH_STATUS: "WORK_AUTH_STATUS",
  WORK_AUTH_ITAR: "WORK_AUTH_ITAR",
  WORK_AUTH_PROOF: "WORK_AUTH_PROOF",

  // Workplace & Availability
  WORKPLACE_RELOCATE: "WORKPLACE_RELOCATE",
  WORKPLACE_ONSITE: "WORKPLACE_ONSITE",
  LEGAL_AGE_18: "LEGAL_AGE_18",
  AVAILABILITY_START_DATE: "AVAILABILITY_START_DATE",
  AVAILABILITY_PROGRAM: "AVAILABILITY_PROGRAM",
  AVAILABILITY_NOTICE: "AVAILABILITY_NOTICE",

  // Employment Checks & Compliance
  EMPLOYMENT_PREVIOUS: "EMPLOYMENT_PREVIOUS",
  EMPLOYMENT_CURRENT_EMPLOYER: "EMPLOYMENT_CURRENT_EMPLOYER",
  EMPLOYMENT_CURRENT_TITLE: "EMPLOYMENT_CURRENT_TITLE",
  EMPLOYMENT_RELATIVES: "EMPLOYMENT_RELATIVES",
  EMPLOYMENT_NON_COMPETE: "EMPLOYMENT_NON_COMPETE",
  EMPLOYMENT_FELONY: "EMPLOYMENT_FELONY",
  COMPENSATION_SALARY: "COMPENSATION_SALARY",
  SOURCE_REFERRAL: "SOURCE_REFERRAL",

  // Demographics
  EEO_GENDER: "EEO_GENDER",
  EEO_RACE: "EEO_RACE",
  EEO_VETERAN: "EEO_VETERAN",
  EEO_DISABILITY: "EEO_DISABILITY",
  EEO_PRONOUNS: "EEO_PRONOUNS",

  // Acknowledgments & Signature
  SIGNATURE: "SIGNATURE",
  DATE_TODAY: "DATE_TODAY",
  CONSENT_AGREEMENT: "CONSENT_AGREEMENT",
  SPECIFY_OTHER: "SPECIFY_OTHER",

  // Disqualifying Custom Essay
  CUSTOM_ESSAY: "CUSTOM_ESSAY",
  UNKNOWN: "UNKNOWN",
};

// Patterns mapping to categories (ordered from most specific to general)
const CATEGORY_RULES = [
  // Custom essay questions that disqualify default job
  {
    category: FieldCategory.CUSTOM_ESSAY,
    patterns: [
      /\bwhy\s*(do\s*you\s*want|this\s*role|us|our\s*company|join)\b/i,
      /\bhardest\s*challenge\b/i,
      /\baccomplish(ment)?\b/i,
      /\bproud(est)?\b/i,
      /\bwriting\s*sample\b/i,
      /\bcode\s*sample\b/i,
      /\btake-?home\b/i,
      /\bessay\b/i,
      /\bexplain\s*your\s*interest\b/i,
      /\bshare\s+(a\s+project|an\s+example|details\s+about)\b/i,
      /\btell\s+us\s+(about\s+a|why)\b/i,
    ],
  },

  // Signature and Date
  {
    category: FieldCategory.SIGNATURE,
    patterns: [
      /\b(electronic|digital|acknowledg\w*)?\s*sign(ature|ed)?\b/i,
      /\btype\s*(your\s*)?(full\s*)?name(\s*to\s*sign|\s*as\s*signature)?\b/i,
      /\bapplicant\s*signature\b/i,
      /\bcandidate\s*signature\b/i,
    ],
  },
  {
    category: FieldCategory.DATE_TODAY,
    patterns: [
      /\btoday('?s)?\s*date\b/i,
      /\bdate\s*of\s*(signature|signing|application)\b/i,
      /\bsign(ature)?\s*date\b/i,
      /\bcurrent\s*date\b/i,
    ],
  },

  // Education / Academic Specifics
  {
    category: FieldCategory.EDU_GPA,
    patterns: [
      /\bgpa\b/i,
      /\bgrade\s*point\s*average\b/i,
      /\bcumulative\s*gpa\b/i,
      /\boverall\s*gpa\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_CURRENT_STUDENT,
    patterns: [
      /\bcurrently\s*(enrolled|a\s*student|attending|in\s*school)\b/i,
      /\bare\s*you\s*(a\s*)?current\s*student\b/i,
      /\bstudent\s*status\b/i,
      /\benrolled\s*in\s*(an?|a\s*degree)\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_GRAD_RANGE,
    patterns: [
      /\bexpect\s*to\s*graduate\s*between\b/i,
      /\bgraduat(e|ing)\s*between\b/i,
      /\bgraduat(e|ing)\s*in\s*\d{4}\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_START_YEAR,
    patterns: [
      /\beducation\s*start\s*year\b/i,
      /\bstart\s*date\s*year\b/i,
      /\bstart[-_ ]year\b/i,
      /\bstart_date\[year\]\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_START_MONTH,
    patterns: [
      /\beducation\s*start\s*month\b/i,
      /\bstart\s*date\s*month\b/i,
      /\bstart[-_ ]month\b/i,
      /\bstart_date\[month\]\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_GRAD_YEAR,
    patterns: [
      /\bgraduation\s*year\b/i,
      /\bgrad\s*year\b/i,
      /\byear\s*of\s*graduation\b/i,
      /\bclass\s*of\b/i,
      /\bend\s*date\s*year\b/i,
      /\bend[-_ ]year\b/i,
      /\bend_date\[year\]\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_GRAD_MONTH,
    patterns: [
      /\bgraduation\s*month\b/i,
      /\bgrad\s*month\b/i,
      /\bmonth\s*of\s*graduation\b/i,
      /\bend\s*date\s*month\b/i,
      /\bend[-_ ]month\b/i,
      /\bend_date\[month\]\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_GRAD_DATE,
    patterns: [
      /\bgraduation\s*date\b/i,
      /\bexpected\s*(to\s*)?graduate\b/i,
      /\bexpect(ed)?\s*graduation\b/i,
      /\bgrad\s*date\b/i,
      /\bwhen.*(will\s*you|do\s*you)\s*graduate\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_DEGREE,
    patterns: [
      /\bdegree\s*(level|type|pursuing)?\b/i,
      /\bhighest\s*(level\s*of\s*)?education\b/i,
      /\blevel\s*of\s*study\b/i,
      /\bpursuing\s*a\s*degree\b/i,
      /\bacademic\s*degree\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_MAJOR,
    patterns: [
      /\bdiscipline\b/i,
      /\bmajor\b/i,
      /\bfield\s*of\s*study\b/i,
      /\barea\s*of\s*study\b/i,
      /\bcourse\s*of\s*study\b/i,
    ],
  },
  {
    category: FieldCategory.EDU_SCHOOL,
    patterns: [
      /\bschool\b/i,
      /\buniversity\b/i,
      /\bcollege\b/i,
      /\binstitution\b/i,
      /\balma\s*mater\b/i,
      /\beducation\b/i,
    ],
  },

  // Contact Info
  {
    category: FieldCategory.CONTACT_PREFERRED_NAME,
    patterns: [/\bpreferred\s*(first\s*)?name\b/i, /\bname\s*you\s*go\s*by\b/i],
  },
  {
    category: FieldCategory.CONTACT_FIRST_NAME,
    patterns: [/\bfirst\s*name\b/i, /\bgiven\s*name\b/i],
  },
  {
    category: FieldCategory.CONTACT_LAST_NAME,
    patterns: [/\blast\s*name\b/i, /\bfamily\s*name\b/i, /\bsurname\b/i],
  },
  {
    category: FieldCategory.CONTACT_FULL_NAME,
    patterns: [/\bfull\s*name\b/i, /\blegal\s*name\b/i, /^names?$/i],
  },
  {
    category: FieldCategory.CONTACT_EMAIL,
    patterns: [/\bemail\b/i, /\be-mail\b/i],
  },
  {
    category: FieldCategory.CONTACT_PHONE,
    patterns: [/\bphone\b/i, /\bmobile\b/i, /\btelephone\b/i],
  },
  {
    category: FieldCategory.CONTACT_CITY,
    patterns: [/\bcity\b/i],
  },
  {
    category: FieldCategory.CONTACT_STATE,
    patterns: [/\bstate(\s*\/\s*province)?\b/i, /\bprovince\b/i],
  },
  {
    category: FieldCategory.CONTACT_POSTAL,
    patterns: [/\bpostal(\s*code)?\b/i, /\bzip(\s*code)?\b/i],
  },
  {
    category: FieldCategory.CONTACT_COUNTRY,
    patterns: [/\bcountry\b/i],
  },
  {
    category: FieldCategory.CONTACT_LOCATION,
    patterns: [
      /\bcurrent\s*location\b/i,
      /\bcandidate\s*location\b/i,
      /\bwhere\s*(are\s*you|do\s*you)\s*(currently\s*)?(located|live|reside)\b/i,
      /\blocation\s*\(city\)/i,
      /\blocation\b/i,
      /\baddress\b/i,
    ],
  },

  // Documents & Links
  {
    category: FieldCategory.DOC_RESUME,
    patterns: [/\bresume\b/i, /\bcv\b/i, /\bcurriculum\s*vitae\b/i],
  },
  {
    category: FieldCategory.DOC_COVER_LETTER,
    patterns: [/\bcover\s*letter\b/i],
  },
  {
    category: FieldCategory.LINK_LINKEDIN,
    patterns: [/\blinkedin\b/i],
  },
  {
    category: FieldCategory.LINK_GITHUB,
    patterns: [/\bgithub\b/i],
  },
  {
    category: FieldCategory.LINK_PORTFOLIO,
    patterns: [/\bportfolio\b/i, /\bpersonal\s*(website|site|url|page)\b/i],
  },
  {
    category: FieldCategory.LINK_WEBSITE,
    patterns: [/\bwebsite\b/i, /\burl\b/i, /\blink\b/i],
  },
  {
    category: FieldCategory.LINK_TWITTER,
    patterns: [/\btwitter\b/i, /\bx\.com\b/i],
  },

  // Work Authorization & Legal
  {
    category: FieldCategory.WORK_AUTH_ITAR,
    patterns: [/\bu\.?s\.?\s*person\b/i, /\bitar\b/i, /\bexport\s*control\b/i],
  },
  {
    category: FieldCategory.WORK_AUTH_STATUS,
    patterns: [
      /\b(immigration|citizenship|right\s*to\s*work)\s*status\b/i,
      /\bselect\s*your\s*current\s*immigration\s*status\b/i,
      /\bcurrent\s*immigration\b/i,
    ],
  },
  {
    category: FieldCategory.WORK_AUTH_SPONSORSHIP,
    patterns: [
      /\bnow\s*or\s*in\s*the\s*future.*sponsorship\b/i,
      /\brequire.*(visa\s*)?sponsorship\b/i,
      /\bsponsorship\b/i,
      /\bvisa\s*sponsorship\b/i,
    ],
  },
  {
    category: FieldCategory.WORK_AUTH_US,
    patterns: [
      /\blegally\s*(authorized|eligible|permitted|entitled)\b/i,
      /\blawfully\s*(authorized|eligible|permitted|entitled)\b/i,
      /\bauthorized\s*to\s*work\b/i,
      /\bauthori[sz]ation\s*to\s*work\b/i,
      /\bright\s*to\s*work\b/i,
      /\blegal\s*rights?\b/i,
      /\beligib(le|ility)\s*to\s*work\b/i,
      /\bcountry\s*where\s*this\s*job\s*is\s*located\b/i,
      /\bproof\s*of\s*(employment\s*)?eligibility\b/i,
    ],
  },

  // Workplace & Availability
  {
    category: FieldCategory.WORKPLACE_RELOCATE,
    patterns: [
      /\binterested\s*in\s*relocating\b/i,
      /\brelocat(e|ion)\b/i,
      /\bopen\s*to\s*relocation\b/i,
      /\bpreferred\s*location\b/i,
    ],
  },
  {
    category: FieldCategory.WORKPLACE_ONSITE,
    patterns: [
      /\bcommute\b/i,
      /\bonsite\b/i,
      /\bin-?office\b/i,
      /\bhybrid\b/i,
      /\bdays?\s*(per|a)\s*week\b/i,
      /\bwork\s*out\s*of\b/i,
      /\bwork\s*from\b/i,
      /\btravel\b/i,
    ],
  },
  {
    category: FieldCategory.LEGAL_AGE_18,
    patterns: [/\b18\s*(years|or\s*older|\+)\b/i, /\bat\s*least\s*18\b/i, /\blegal\s*age\b/i],
  },
  {
    category: FieldCategory.AVAILABILITY_PROGRAM,
    patterns: [
      /\binternship\s*program\b/i,
      /\bprogram\s*(are\s*you\s*)?applying\s*for\b/i,
      /\bposition\s*(type|applied)\b/i,
      /\bterm\s*(are\s*you\s*)?applying\b/i,
      /\bseason\b/i,
      /\bsemester\b/i,
      /\bquarter\b/i,
    ],
  },
  {
    category: FieldCategory.AVAILABILITY_START_DATE,
    patterns: [
      /\bstart\s*date\b/i,
      /\bearliest\s*(start|avaiabl\w*|availab\w*)\b/i,
      /\bavaiabl(le|ility)\b/i,
      /\bavailab(le|ility)\b/i,
      /\bwhen.*(start|begin)\b/i,
      /\blook\s*to\s*start\b/i,
      /\bable\s*to\s*join\b/i,
    ],
  },
  {
    category: FieldCategory.AVAILABILITY_NOTICE,
    patterns: [/\bnotice\s*period\b/i],
  },

  // Employment Checks
  {
    category: FieldCategory.EMPLOYMENT_CURRENT_EMPLOYER,
    patterns: [/\bcurrent\s*(company|employer)\b/i, /\bpresent\s*(company|employer)\b/i],
  },
  {
    category: FieldCategory.EMPLOYMENT_CURRENT_TITLE,
    patterns: [/\bcurrent\s*(job\s*)?title\b/i, /\bcurrent\s*role\b/i, /\bpresent\s*(job\s*)?title\b/i],
  },
  {
    category: FieldCategory.EMPLOYMENT_PREVIOUS,
    patterns: [
      /\bpreviously\s*(worked|employed|applied)\b/i,
      /\bformer\s*(employee|intern)\b/i,
      /\bever\s*worked\s*at\b/i,
      /\bdeloitte|pwc|ey|kpmg|firm'?s\s*independent\s*accountants\b/i,
    ],
  },
  {
    category: FieldCategory.EMPLOYMENT_RELATIVES,
    patterns: [
      /\bimmediate\s*family(\s*member)?\b/i,
      /\brelatives?\b/i,
      /\bfamily\s*members?\b/i,
      /\bconflict\s*of\s*interest\b/i,
    ],
  },
  {
    category: FieldCategory.EMPLOYMENT_NON_COMPETE,
    patterns: [/\bnon-?compete\b/i, /\brestrictive\s*covenant\b/i, /\bnon-?solicit\b/i],
  },
  {
    category: FieldCategory.EMPLOYMENT_FELONY,
    patterns: [/\bfelony\b/i, /\bconvicted\b/i, /\bcriminal\b/i],
  },
  {
    category: FieldCategory.COMPENSATION_SALARY,
    patterns: [
      /\bcompensation\b/i,
      /\bsalary\b/i,
      /\bpay\s*expectation\b/i,
      /\bdesired\s*salary\b/i,
      /\btarget\s*compensation\b/i,
    ],
  },
  {
    category: FieldCategory.SOURCE_REFERRAL,
    patterns: [
      /\bhear\s*about\b/i,
      /\blearn\s*about\b/i,
      /\bfind\s*out\s*about\b/i,
      /\bconnect(ed)?\s*with\s*us\b/i,
      /\bhow\s*did\s*you\s*(first\s*)?(hear|find|connect|learn)\b/i,
      /\bwhere\s*did\s*you\s*(hear|find)\b/i,
      /\bsource\b/i,
      /\breferral\b/i,
      /\breferred\b/i,
    ],
  },

  // Demographics
  {
    category: FieldCategory.EEO_GENDER,
    patterns: [/\bgender\b/i],
  },
  {
    category: FieldCategory.EEO_RACE,
    patterns: [/\brace\b/i, /\bethnicity\b/i, /\bhispanic\b/i, /\blatino\b/i],
  },
  {
    category: FieldCategory.EEO_VETERAN,
    patterns: [/\bveteran\b/i],
  },
  {
    category: FieldCategory.EEO_DISABILITY,
    patterns: [/\bdisability\b/i],
  },
  {
    category: FieldCategory.EEO_PRONOUNS,
    patterns: [/\bpronouns\b/i],
  },

  // Consents & Acknowledgments
  {
    category: FieldCategory.CONSENT_AGREEMENT,
    patterns: [
      /\bconsent\b/i,
      /\bterms\b/i,
      /\bprivacy\s*policy\b/i,
      /\btexting\b/i,
      /\bsms\b/i,
      /\bwhatsapp\b/i,
      /\backnowledge\b/i,
      /\bcertify\b/i,
      /\baffirm\b/i,
      /\battest\b/i,
      /\bagreement\b/i,
      /\bbrighthire\b/i,
      /\binterview.*record\b/i,
      /\bbackground\s*check\b/i,
      /\bdrug\s*(screen|test)\b/i,
      /\baccurate\b/i,
    ],
  },
  {
    category: FieldCategory.SPECIFY_OTHER,
    patterns: [/\bif\s*you\s*selected\s*.*other\b/i, /\bplease\s*specify\b/i, /^other$/i],
  },
];

/**
 * Classifies a question prompt into a known semantic category.
 */
function classifyField(label) {
  if (!label || typeof label !== "string") {
    return { category: FieldCategory.UNKNOWN, confidence: 0 };
  }
  const clean = label.trim().replace(/\s+/g, " ");
  if (!clean) return { category: FieldCategory.UNKNOWN, confidence: 0 };

  for (const rule of CATEGORY_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(clean)) {
        return { category: rule.category, confidence: 0.9, matchedPattern: pat.toString() };
      }
    }
  }

  return { category: FieldCategory.UNKNOWN, confidence: 0 };
}

/**
 * Normalizes degree text into fuzzy candidate options.
 */
function getDegreeOptionCandidates(degreeText) {
  const d = (degreeText || "").toLowerCase();
  if (d.includes("bachelor") || d.includes("b.s") || d.includes("bs") || d.includes("b.a") || d.includes("ba") || d.includes("undergrad")) {
    return [
      "Bachelor of Science",
      "Bachelor's Degree",
      "Bachelor's",
      "Bachelor of Arts",
      "Bachelor",
      "B.S.",
      "BS",
      "B.A.",
      "BA",
      "Undergraduate",
      "College / University",
    ];
  }
  if (d.includes("master") || d.includes("m.s") || d.includes("ms") || d.includes("m.a") || d.includes("ma") || d.includes("grad")) {
    return [
      "Master of Science",
      "Master's Degree",
      "Master's",
      "Master of Arts",
      "Master",
      "M.S.",
      "MS",
      "M.A.",
      "MA",
      "Graduate",
    ];
  }
  if (d.includes("phd") || d.includes("doctor") || d.includes("ph.d")) {
    return [
      "Doctor of Philosophy",
      "Doctorate",
      "Doctoral",
      "Ph.D.",
      "PhD",
    ];
  }
  return [degreeText, "Bachelor's Degree", "Bachelor", "Undergraduate"].filter(Boolean);
}

function educationMonthCandidates(month) {
  if (!month) return [];
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const number = Number(month);
  if (Number.isInteger(number) && number >= 1 && number <= 12) {
    return [names[number - 1], String(number).padStart(2, "0"), String(number)];
  }
  return [String(month)];
}

/**
 * Evaluates whether graduation date falls within a question range.
 * e.g. "Do you expect to graduate between October 2027 and June 2028?"
 */
function evaluateGraduationRange(labelText, gradYear, gradMonth) {
  const years = (labelText.match(/\b(202\d)\b/g) || []).map(Number);
  if (years.length >= 2) {
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const y = gradYear || new Date().getFullYear();
    const inRange = y >= minYear && y <= maxYear;
    return inRange ? ["Yes", "true"] : ["No", "false"];
  }
  return ["Yes", "true"];
}

function customAnswerForLabel(profile, label) {
  if (!label || !Array.isArray(profile.customAnswers)) return null;
  const normalized = label.trim().toLowerCase();
  for (const item of profile.customAnswers) {
    if (!item || typeof item.match !== "string") continue;
    let matches = false;
    const expression = item.match.match(/^\/(.*)\/([dgimsuvy]*)$/);
    if (expression) {
      try {
        matches = new RegExp(expression[1], expression[2]).test(label);
      } catch {}
    } else {
      matches = normalized.includes(item.match.trim().toLowerCase());
    }
    if (!matches) continue;

    const answer = item.answer;
    if (typeof answer === "boolean") {
      return {
        custom: true,
        booleanVal: answer,
        optionCandidates: answer ? ["Yes", "true"] : ["No", "false"],
      };
    }
    if (Array.isArray(answer)) {
      return { custom: true, text: answer[0] || "", optionCandidates: answer };
    }
    return { custom: true, text: String(answer), optionCandidates: [String(answer)] };
  }
  return null;
}

/**
 * Resolves the answer payload for a given field category based on the profile.
 */
function resolveFieldValue(category, profile, roleType, context = {}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const defaultDateStr = now.toISOString().split("T")[0];
  const mmddyyyy = `${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getDate().toString().padStart(2, "0")}/${currentYear}`;
  const custom = customAnswerForLabel(profile, context.label || "");
  if (custom) return custom;

  switch (category) {
    case FieldCategory.CONTACT_FIRST_NAME:
      return { text: profile.firstName };

    case FieldCategory.CONTACT_PREFERRED_NAME:
      return { text: profile.firstName };

    case FieldCategory.CONTACT_LAST_NAME:
      return { text: profile.lastName };

    case FieldCategory.CONTACT_FULL_NAME:
    case FieldCategory.SIGNATURE:
      return { text: `${profile.firstName} ${profile.lastName}` };

    case FieldCategory.CONTACT_EMAIL:
      return { text: profile.email };

    case FieldCategory.CONTACT_PHONE:
      return { text: profile.phone };

    case FieldCategory.CONTACT_CITY:
      return { text: profile.address?.city || "" };

    case FieldCategory.CONTACT_STATE:
      return { text: profile.address?.state || "" };

    case FieldCategory.CONTACT_POSTAL:
      return { text: profile.address?.postalCode || "" };

    case FieldCategory.CONTACT_COUNTRY:
      return { text: profile.address?.country || "United States", optionCandidates: ["United States", "USA", "US"] };

    case FieldCategory.CONTACT_LOCATION:
    case FieldCategory.CONTACT_ADDRESS: {
      const loc = [profile.address?.city, profile.address?.state].filter(Boolean).join(", ");
      return { text: loc || "United States", optionCandidates: [loc, profile.address?.city, "United States"].filter(Boolean) };
    }

    case FieldCategory.DATE_TODAY:
      return { text: defaultDateStr, formattedDate: mmddyyyy, optionCandidates: [defaultDateStr, mmddyyyy] };

    // Education
    case FieldCategory.EDU_SCHOOL:
      return { text: profile.education?.school || "", isAutocomplete: true };

    case FieldCategory.EDU_DEGREE: {
      const degree = profile.education?.degree;
      if (!degree) return null;
      const candidates = getDegreeOptionCandidates(degree);
      return { text: degree, optionCandidates: candidates };
    }

    case FieldCategory.EDU_MAJOR: {
      const major = profile.education?.discipline;
      if (!major) return null;
      return { text: major, optionCandidates: [major] };
    }

    case FieldCategory.EDU_GPA:
      return profile.education?.gpa ? { text: String(profile.education.gpa) } : null;

    case FieldCategory.EDU_START_YEAR: {
      const yr = profile.education?.startYear;
      return yr ? { text: String(yr), optionCandidates: [String(yr)] } : null;
    }

    case FieldCategory.EDU_START_MONTH: {
      const m = profile.education?.startMonth;
      return m ? { text: String(m), optionCandidates: educationMonthCandidates(m) } : null;
    }

    case FieldCategory.EDU_GRAD_YEAR: {
      const yr = profile.education?.graduationYear;
      return yr ? { text: String(yr), optionCandidates: [String(yr)] } : null;
    }

    case FieldCategory.EDU_GRAD_MONTH: {
      const m = profile.education?.graduationMonth;
      return m ? { text: String(m), optionCandidates: educationMonthCandidates(m) } : null;
    }

    case FieldCategory.EDU_GRAD_DATE: {
      const yr = profile.education?.graduationYear;
      const m = profile.education?.graduationMonth;
      if (!yr || !m) return null;
      const mPad = String(m).padStart(2, "0");
      const gradDateStr = `${yr}-${mPad}-01`;
      return {
        text: gradDateStr,
        optionCandidates: [
          String(yr),
          `May ${yr}`,
          `Spring ${yr}`,
          `Summer ${yr}`,
          `${mPad}/${yr}`,
          gradDateStr,
        ],
      };
    }

    case FieldCategory.EDU_CURRENT_STUDENT:
      if (profile.answers?.currentStudent === undefined) return null;
      return profile.answers.currentStudent
        ? { booleanVal: true, optionCandidates: ["Yes", "true", "Enrolled", "Full-time"] }
        : { booleanVal: false, optionCandidates: ["No", "false", "Not enrolled"] };

    case FieldCategory.EDU_GRAD_RANGE:
      if (!profile.education?.graduationYear) return null;
      return {
        optionCandidates: evaluateGraduationRange(
          context.label || "",
          profile.education?.graduationYear,
          profile.education?.graduationMonth
        ),
      };

    // Work Authorization
    case FieldCategory.WORK_AUTH_US:
    case FieldCategory.WORK_AUTH_PROOF: {
      const auth = profile.workAuthorization?.authorizedInUS !== false;
      return { booleanVal: auth, optionCandidates: auth ? ["Yes", "true"] : ["No", "false"] };
    }

    case FieldCategory.WORK_AUTH_SPONSORSHIP: {
      const needSponsor = profile.workAuthorization?.requiresSponsorship === true;
      return { booleanVal: needSponsor, optionCandidates: needSponsor ? ["Yes", "true"] : ["No", "false"] };
    }

    case FieldCategory.WORK_AUTH_STATUS: {
      const statusText = profile.workAuthorization?.statusText ||
        (profile.workAuthorization?.requiresSponsorship
          ? "Authorized to work (requires sponsorship)"
          : "US Citizen / Authorized to work in US without restriction");
      return {
        text: statusText,
        optionCandidates: ["Citizen", "Permanent Resident", "Authorized", "US Citizen", "No Sponsorship Needed"],
      };
    }

    case FieldCategory.WORK_AUTH_ITAR: {
      const isUsPerson = profile.workAuthorization?.authorizedInUS !== false && !profile.workAuthorization?.requiresSponsorship;
      return { booleanVal: isUsPerson, optionCandidates: isUsPerson ? ["Yes", "true"] : ["No", "false"] };
    }

    // Workplace & Availability
    case FieldCategory.WORKPLACE_RELOCATE: {
      const relocate = profile.willingToRelocate !== false;
      return { booleanVal: relocate, optionCandidates: relocate ? ["Yes", "true", "Flexible", "All locations"] : ["No", "false"] };
    }

    case FieldCategory.WORKPLACE_ONSITE: {
      const answer = profile.answers?.willingOnsite;
      if (answer === undefined) return null;
      return { booleanVal: answer, optionCandidates: answer ? ["Yes", "true"] : ["No", "false"] };
    }

    case FieldCategory.LEGAL_AGE_18: {
      const answer = profile.answers?.over18;
      if (answer === undefined) return null;
      return { booleanVal: answer, optionCandidates: answer ? ["Yes", "true"] : ["No", "false"] };
    }

    case FieldCategory.AVAILABILITY_START_DATE: {
      const sDate = profile.startDate || "Immediately";
      return { text: sDate, optionCandidates: [sDate, "Immediately", "Flexible", "Summer 2026", "Fall 2026"] };
    }

    case FieldCategory.AVAILABILITY_PROGRAM: {
      const isIntern = roleType === "intern";
      const configured = profile.answers?.program;
      return {
        text: configured || (isIntern ? "Internship" : "Full-time"),
        optionCandidates: configured
          ? [configured]
          : isIntern
            ? ["Internship", "Intern"]
            : ["Full-time", "New Grad"],
      };
    }

    case FieldCategory.AVAILABILITY_NOTICE:
      return profile.answers?.noticePeriod
        ? { text: profile.answers.noticePeriod, optionCandidates: [profile.answers.noticePeriod] }
        : null;

    // Employment Checks
    case FieldCategory.EMPLOYMENT_CURRENT_EMPLOYER:
      return profile.answers?.currentEmployer ? { text: profile.answers.currentEmployer } : null;
    case FieldCategory.EMPLOYMENT_CURRENT_TITLE:
      return profile.answers?.currentTitle ? { text: profile.answers.currentTitle } : null;
    case FieldCategory.EMPLOYMENT_PREVIOUS: {
      const answer = profile.answers?.previousEmployee;
      if (answer === undefined) return null;
      return { booleanVal: answer, optionCandidates: answer ? ["Yes", "true"] : ["No", "false"] };
    }
    case FieldCategory.EMPLOYMENT_RELATIVES: {
      const answer = profile.answers?.hasRelativesAtCompany;
      if (answer === undefined) return null;
      return { booleanVal: answer, optionCandidates: answer ? ["Yes", "true"] : ["No", "false"] };
    }
    case FieldCategory.EMPLOYMENT_NON_COMPETE: {
      const answer = profile.answers?.subjectToNonCompete;
      if (answer === undefined) return null;
      return { booleanVal: answer, optionCandidates: answer ? ["Yes", "true"] : ["No", "false", "None"] };
    }
    case FieldCategory.EMPLOYMENT_FELONY: {
      const answer = profile.answers?.felonyConviction;
      if (answer === undefined) return null;
      return { booleanVal: answer, optionCandidates: answer ? ["Yes", "true"] : ["No", "false", "None"] };
    }

    case FieldCategory.COMPENSATION_SALARY: {
      const sal = profile.desiredSalary !== undefined ? String(profile.desiredSalary) : "Negotiable";
      const numOnly = String(sal).replace(/\D+/g, "") || "0";
      return { text: sal, numericText: numOnly };
    }

    case FieldCategory.SOURCE_REFERRAL:
      return profile.answers?.referralSource
        ? { text: profile.answers.referralSource, optionCandidates: [profile.answers.referralSource] }
        : null;

    // Demographics
    case FieldCategory.EEO_GENDER:
      return { optionCandidates: [profile.demographics?.gender || "Decline", "Decline to Self-Identify"] };
    case FieldCategory.EEO_RACE:
      return { optionCandidates: [profile.demographics?.race || "Decline", "Decline to Self-Identify", "No"] };
    case FieldCategory.EEO_VETERAN:
      return { optionCandidates: [profile.demographics?.veteran || "Decline", "not a protected", "Decline to Self-Identify"] };
    case FieldCategory.EEO_DISABILITY:
      return { optionCandidates: [profile.demographics?.disability || "Decline", "No, I do not", "Decline to Self-Identify"] };
    case FieldCategory.EEO_PRONOUNS:
      return {
        text: profile.answers?.pronouns || "Prefer not to say",
        optionCandidates: [profile.answers?.pronouns || "Prefer not to say", "Decline"],
      };

    case FieldCategory.CONSENT_AGREEMENT:
      return { booleanVal: true, optionCandidates: ["Yes", "Agree", "I agree", "Consent", "I consent", "true"] };

    case FieldCategory.SPECIFY_OTHER:
      return { text: "N/A" };

    default:
      return null;
  }
}

module.exports = {
  FieldCategory,
  classifyField,
  resolveFieldValue,
  getDegreeOptionCandidates,
};
