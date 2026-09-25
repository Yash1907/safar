const { chromium } = require("playwright");
const fs = require("node:fs");

async function fillField(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        await el.fill(value);
        return true;
      }
    } catch {}
  }
  return false;
}

async function selectAnyOption(page, targetElOrSelector, preferredValues) {
  try {
    const el = typeof targetElOrSelector === "string" ? await page.$(targetElOrSelector) : targetElOrSelector;
    if (!el || !(await el.isVisible())) return false;

    const isStandardSelect = await el.evaluate(e => e.tagName === "SELECT");
    if (isStandardSelect) {
      const options = await el.$$eval("option", opts => opts.map(o => ({ value: o.value, text: o.text.trim() })));
      for (const pref of preferredValues) {
        const match = options.find(o => o.text.toLowerCase().includes(pref.toLowerCase()) || o.value.toLowerCase().includes(pref.toLowerCase()));
        if (match) {
          await el.selectOption(match.value);
          return true;
        }
      }
      return false;
    }

    // Combobox or react-select
    const control = await el.evaluateHandle(e => {
      return e.closest(".select__control") || e.closest("[class*='select']") || e;
    });

    await control.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);

    const menu = await page.$(".select__menu, [role='listbox']");
    if (menu) {
      for (const pref of preferredValues) {
        if (!pref) continue;
        const opt = await page.$(`.select__option:has-text("${pref}"), [role='option']:has-text("${pref}")`);
        if (opt && (await opt.isVisible())) {
          await opt.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(200);
          return true;
        }
      }
      // Single-eval fallback across all options in browser
      const foundIndex = await page.$$eval(
        ".select__option, [role='option']",
        (opts, prefs) => {
          for (let i = 0; i < opts.length; i++) {
            const t = opts[i].textContent.toLowerCase();
            if (prefs.some((p) => p && t.includes(String(p).toLowerCase()))) return i;
          }
          return -1;
        },
        preferredValues
      );

      if (foundIndex >= 0) {
        const allOpts = await page.$$(".select__option, [role='option']");
        if (allOpts[foundIndex]) {
          await allOpts[foundIndex].click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(200);
          return true;
        }
      }
    }
    // Close menu if no match found
    await page.keyboard.press("Escape").catch(() => {});
  } catch {}
  return false;
}

async function selectOption(page, selectSelectors, preferredValues) {
  for (const sel of selectSelectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        const ok = await selectAnyOption(page, el, preferredValues);
        if (ok) return true;
      }
    } catch {}
  }
  return false;
}

async function answerGeneralQuestions(page, profile, platform) {
  const containerSelector = platform === "ashby"
    ? "[class*='fieldEntry'], .field, .form-group, div:has(> label)"
    : ".field, [class*='field'], .form-group, div:has(> label)";

  const fields = await page.$$(containerSelector);
  for (const f of fields) {
    try {
      const labelEl = await f.$("label");
      let labelText = "";
      if (labelEl) {
        labelText = (await labelEl.innerText()).trim();
      }
      if (!labelText) {
        labelText = await f.evaluate(el => el.getAttribute("aria-label") || el.innerText.split("\n")[0] || "");
      }
      if (!labelText) continue;
      const l = labelText.toLowerCase().replace(/\s+/g, " ");

      const input = await f.$("input:not([type='hidden']):not([type='file']):not([type='submit']), select, textarea");
      if (!input || !(await input.isVisible())) continue;

      const isFilled = await input.evaluate(el => {
        if (el.tagName === "SELECT") return el.selectedIndex > 0;
        if (el.value && el.value.trim().length > 0) return true;
        const control = el.closest(".select__control");
        if (control && !control.textContent.includes("Select...")) return true;
        return false;
      });
      if (isFilled) continue;

      const isCombobox = await input.evaluate(el =>
        el.getAttribute("role") === "combobox" || el.tagName === "SELECT" || !!el.closest(".select__control")
      );

      // 1. Work authorization status (e.g. "Please provide your right to work status")
      if (/status|type|explain|specify|current\s*immigration/i.test(l) && (/right\s*to\s*work|work\s*auth|immigration|eligib/i.test(l))) {
        const statusText = profile.workAuthorization?.statusText ||
          (profile.workAuthorization?.requiresSponsorship
            ? "Authorized to work (requires sponsorship)"
            : "US Citizen / Authorized to work in US without restriction");
        if (isCombobox) {
          await selectAnyOption(page, input, ["Citizen", "Permanent Resident", "Authorized", "No Sponsorship", "US Citizen"]);
        } else {
          await input.fill(statusText);
        }
      }
      // 2. Right to work / Work authorization (Yes/No)
      else if (/right\s*to\s*work|authorized\s*to\s*work|eligible\s*to\s*work|legal\s*right|work\s*authori[sz]ation|lawfully\s*authorized/i.test(l)) {
        const preferred = profile.workAuthorization?.authorizedInUS === false ? ["No", "false"] : ["Yes", "true"];
        if (isCombobox) {
          await selectAnyOption(page, input, preferred);
        } else {
          await input.fill(preferred[0]);
        }
      }
      // 3. Visa sponsorship (Yes/No)
      else if (/sponsorship|visa\s*sponsorship/i.test(l)) {
        const preferred = profile.workAuthorization?.requiresSponsorship ? ["Yes", "true"] : ["No", "false"];
        if (isCombobox) {
          await selectAnyOption(page, input, preferred);
        } else {
          await input.fill(preferred[0]);
        }
      }
      // 4. Full legal name / Surname confirmation
      else if (/full\s*legal\s*name|legal\s*name.*surname|middle\s*name/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["Yes", "true"]);
        } else {
          await input.fill("Yes");
        }
      }
      // 5. How did you hear / Connect / Source / Referral
      else if (/hear\s*about|connect(ed)?\s*with\s*us|source|referral/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["LinkedIn", "Job Board", "Online", "Website", "Other"]);
        } else {
          await input.fill("LinkedIn");
        }
      }
      // 6. Willing to Relocate
      else if (/relocat/i.test(l)) {
        const preferred = profile.willingToRelocate === false ? ["No", "false"] : ["Yes", "true"];
        if (isCombobox) {
          await selectAnyOption(page, input, preferred);
        } else {
          await input.fill(preferred[0]);
        }
      }
      // 7. Commute / Onsite / Hybrid / Office presence / Days per week
      else if (/commute|onsite|in-?office|hybrid|days?\s*(a|per)\s*week|work\s*(out\s*of|from)\s*our\s*.*office/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["Yes", "true"]);
        } else {
          await input.fill("Yes");
        }
      }
      // 8. 18+ years of age / Legal age
      else if (/18\s*(years|or\s*older|\+)|at\s*least\s*18|legal\s*age/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["Yes", "true"]);
        } else {
          await input.fill("Yes");
        }
      }
      // 9. Earliest availability / Start date
      else if (/start\s*date|earliest\s*(start|availab)|available\s*to\s*start|when.*(start|begin)/i.test(l)) {
        const inputType = await input.getAttribute("type");
        const defaultDateText = profile.startDate || "Immediately";
        if (isCombobox) {
          const prefs = [profile.startDate, "Immediately", "Flexible", "Summer 2026", "Fall 2026"].filter(Boolean);
          await selectAnyOption(page, input, prefs);
        } else if (inputType === "date") {
          const pickerVal = formatDateForPicker(profile.startDate);
          await input.fill(pickerVal);
        } else {
          await input.fill(defaultDateText);
        }
      }
      // 10. Notice period
      else if (/notice\s*period/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["None", "Immediate", "0"]);
        } else {
          await input.fill("None");
        }
      }
      // 11. Previously employed / Former employee / Applied before
      else if (/previously\s*(worked|employed|applied)|former\s*employee|ever\s*worked\s*at/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["No", "false"]);
        } else {
          await input.fill("No");
        }
      }
      // 12. Non-compete
      else if (/non-?compete|restrictive\s*covenant/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["No", "None", "false"]);
        } else {
          await input.fill("None");
        }
      }
      // 13. Desired salary / Target compensation
      else if (/desired\s*salary|target\s*compensation|salary\s*expectation|compensation/i.test(l)) {
        const inputType = await input.getAttribute("type");
        const numericOnly = /numeric|number|digits|without\s*special\s*char/i.test(l);
        if (inputType === "number" || numericOnly) {
          let numVal = "";
          if (profile.desiredSalary !== undefined) {
            numVal = String(profile.desiredSalary).replace(/\D+/g, "");
          }
          if (!numVal) {
            const req = await isFieldRequired(page, input);
            if (req) numVal = "0";
          }
          if (numVal) {
            await input.fill(numVal);
          }
        } else if (!isCombobox) {
          const salText = profile.desiredSalary !== undefined ? String(profile.desiredSalary) : "Negotiable";
          await input.fill(salText);
        }
      }
      // 14. Links & Social Profiles in general loop (handles custom Greenhouse/Ashby link questions)
      else if (/linkedin/i.test(l)) {
        if (!isCombobox && profile.linkedinUrl) {
          await input.fill(profile.linkedinUrl);
        }
      }
      else if (/github/i.test(l)) {
        if (!isCombobox && profile.githubUrl) {
          const req = await isFieldRequired(page, input);
          if (!profile.githubOnlyIfRequired || req) {
            await input.fill(profile.githubUrl);
          }
        }
      }
      else if (/portfolio|personal\s*(website|site|url|page)|other\s*website|website.*portfolio/i.test(l)) {
        if (!isCombobox) {
          const urlVal = profile.portfolioUrl || (!profile.githubOnlyIfRequired ? profile.githubUrl : "") || profile.linkedinUrl;
          if (urlVal) await input.fill(urlVal);
        }
      }
      // 15. Consent / Interview recording / BrightHire / Policy / Terms
      else if (/brighthire|interview.*record|consent.*record|record.*interview|record(ed)?|consent|agree.*terms|terms.*condition|privacy\s*policy/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["Yes", "Agree", "I agree", "Consent", "I consent", "true"]);
        } else {
          const type = await input.getAttribute("type");
          if (type === "checkbox") {
            await input.check().catch(() => input.click().catch(() => {}));
          } else {
            await input.fill("Yes");
          }
        }
      }
      // 16. "If you selected other, please specify"
      else if (/if\s*you\s*selected\s*.*other|please\s*specify/i.test(l)) {
        if (!isCombobox) {
          await input.fill("N/A");
        }
      }
      // 17. Demographics in general loop
      else if (/gender/i.test(l)) {
        await selectAnyOption(page, input, [profile.demographics?.gender || "Decline", "Decline to Self-Identify"]);
      } else if (/race|ethnicity|hispanic|latino/i.test(l)) {
        await selectAnyOption(page, input, [profile.demographics?.race || "Decline", "Decline to Self-Identify", "No"]);
      } else if (/veteran/i.test(l)) {
        await selectAnyOption(page, input, [profile.demographics?.veteran || "Decline", "not a protected", "Decline to Self-Identify"]);
      } else if (/disability/i.test(l)) {
        await selectAnyOption(page, input, [profile.demographics?.disability || "Decline", "No, I do not", "Decline to Self-Identify"]);
      }
    } catch {}
  }
}

async function isFieldRequired(page, el) {
  if (!el) return false;
  try {
    const isReq = await el.evaluate((input) => {
      if (input.required || input.getAttribute("aria-required") === "true") return true;
      const container = input.closest(".field, .form-group, div, label, li");
      if (container) {
        if (container.querySelector(".required, [required], [aria-required='true'], [aria-hidden='false'] .asterisk")) return true;
        const text = container.textContent || "";
        if (/\*|\(required\)/i.test(text) && !/\(optional\)/i.test(text)) return true;
      }
      return false;
    });
    return !!isReq;
  } catch {
    return false;
  }
}

async function fillGithubField(page, selectors, githubUrl, onlyIfRequired) {
  if (!githubUrl) return false;
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        if (onlyIfRequired) {
          const req = await isFieldRequired(page, el);
          if (!req) return false;
        }
        await el.fill(githubUrl);
        return true;
      }
    } catch {}
  }
  return false;
}

async function findAndFillLink(page, linkType, url, onlyIfRequired = false) {
  if (!url) return false;
  const selectors = [
    `input[name*="${linkType}" i]`,
    `input[id*="${linkType}" i]`,
    `input[aria-label*="${linkType}" i]`,
    `input[placeholder*="${linkType}" i]`,
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible())) {
        if (onlyIfRequired) {
          const req = await isFieldRequired(page, el);
          if (!req) return false;
        }
        await el.fill(url);
        return true;
      }
    } catch {}
  }

  try {
    const label = await page.$(`label:has-text("${linkType}")`);
    if (label && (await label.isVisible())) {
      const forId = await label.getAttribute("for");
      let input = forId ? await page.$("#" + forId) : null;
      if (!input) {
        const container = await label.evaluateHandle((el) =>
          el.closest(".field, [class*='field'], .form-group, div")
        );
        input = await container.$("input:not([type='hidden']):not([type='file'])");
      }
      if (input && (await input.isVisible())) {
        if (onlyIfRequired) {
          const req = await isFieldRequired(page, input);
          if (!req) return false;
        }
        await input.fill(url);
        return true;
      }
    }
  } catch {}

  return false;
}

function normalizeMonth(m) {
  if (!m) return [];
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  if (typeof m === "number" || /^\d+$/.test(String(m).trim())) {
    const num = Number(m);
    if (num >= 1 && num <= 12) {
      const name = monthNames[num - 1];
      const twoDigit = num < 10 ? `0${num}` : `${num}`;
      return [name, twoDigit, `${num}`];
    }
  }
  const str = String(m).trim();
  return [str];
}

function formatDateForPicker(val) {
  if (!val) return new Date().toISOString().split("T")[0];
  const str = String(val).trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  // YYYY-M-D
  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, "0");
    const d = ymdMatch[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // MM/DD/YYYY
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const m = mdyMatch[1].padStart(2, "0");
    const d = mdyMatch[2].padStart(2, "0");
    const y = mdyMatch[3];
    return `${y}-${m}-${d}`;
  }
  // Season heuristics like "Summer 2026", "Fall 2026", "Spring 2026"
  const seasonMatch = str.match(/\b(summer|fall|spring|winter)\s*(\d{4})?\b/i);
  if (seasonMatch) {
    const season = seasonMatch[1].toLowerCase();
    const year = seasonMatch[2] || String(new Date().getFullYear());
    if (season === "summer") return `${year}-06-01`;
    if (season === "fall") return `${year}-09-01`;
    if (season === "spring") return `${year}-01-15`;
    if (season === "winter") return `${year}-12-01`;
  }
  // Try Date.parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }
  return new Date().toISOString().split("T")[0];
}

async function runAutoApply({ url, platform, profile, dryRun, headless }) {
  const isHeadless = headless !== false;
  const launchArgs = isHeadless
    ? ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
    : ["--disable-blink-features=AutomationControlled", "--no-sandbox"];

  const browser = await chromium.launch({
    headless: isHeadless,
    args: launchArgs,
    slowMo: isHeadless ? undefined : 60,
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: isHeadless ? undefined : { width: 1280, height: 900 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
    window.chrome = {
      runtime: {},
      app: {},
      loadTimes: () => {},
      csi: () => {},
    };
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Ensure resume file exists if specified
    const resumeExists = profile.resumePath && fs.existsSync(profile.resumePath);

    if (platform === "greenhouse") {
      // 0. Country combobox (if present, select first to avoid React re-rendering clearing inputs)
      const countryEl = await page.$('#country, input[name*="country" i]');
      if (countryEl && await countryEl.isVisible()) {
        await selectAnyOption(page, countryEl, ["United States", "USA", "US"]);
      }

      // 1. First & Last Name
      await fillField(page, [
        'input[name*="first_name" i]',
        'input[id*="first_name" i]',
        'input[autocomplete="given-name"]',
        '#first_name',
      ], profile.firstName);

      await fillField(page, [
        'input[name*="last_name" i]',
        'input[id*="last_name" i]',
        'input[autocomplete="family-name"]',
        '#last_name',
      ], profile.lastName);

      // If full name field instead of split
      await fillField(page, [
        'input[name="name" i]',
        'input[id="name" i]',
      ], `${profile.firstName} ${profile.lastName}`);

      // 2. Email & Phone
      await fillField(page, [
        'input[type="email"]',
        'input[name*="email" i]',
        '#email',
      ], profile.email);

      await fillField(page, [
        'input[type="tel"]',
        'input[name*="phone" i]',
        '#phone',
      ], profile.phone);

      // 3. Location / Address
      if (profile.address?.city || profile.address?.state) {
        const loc = [profile.address.city, profile.address.state].filter(Boolean).join(", ");
        await fillField(page, [
          'input[name*="location" i]',
          'input[id*="location" i]',
          'input[id*="candidate_location" i]',
        ], loc);
      }

      // 4. Resume upload
      if (resumeExists) {
        const fileInputs = await page.$$('input[type="file"]');
        for (const input of fileInputs) {
          const name = ((await input.getAttribute("name")) || "").toLowerCase();
          const id = ((await input.getAttribute("id")) || "").toLowerCase();
          if (name.includes("resume") || id.includes("resume") || fileInputs.length === 1) {
            await input.setInputFiles(profile.resumePath);
            await page.waitForTimeout(2000);
            break;
          }
        }
      }

      // 5. Links: LinkedIn, GitHub, Website
      await findAndFillLink(page, "linkedin", profile.linkedinUrl);
      await findAndFillLink(page, "github", profile.githubUrl, profile.githubOnlyIfRequired);
      await findAndFillLink(page, "website", profile.portfolioUrl) ||
        await findAndFillLink(page, "portfolio", profile.portfolioUrl);

      // 6. School / Education
      if (profile.education?.school) {
        await fillField(page, ['input[name*="school" i]', 'input[id*="school" i]'], profile.education.school);
      }
      if (profile.education?.degree) {
        await fillField(page, ['input[name*="degree" i]', 'input[id*="degree" i]'], profile.education.degree);
        await selectOption(page, ['select[name*="degree" i]', 'select[id*="degree" i]'], [profile.education.degree]);
      }
      if (profile.education?.discipline) {
        await fillField(page, ['input[name*="discipline" i]', 'input[id*="discipline" i]'], profile.education.discipline);
        await selectOption(page, ['select[name*="discipline" i]', 'select[id*="discipline" i]'], [profile.education.discipline]);
      }
      if (profile.education?.graduationYear) {
        const yr = String(profile.education.graduationYear);
        await selectOption(page, [
          'select[name*="end_date[year]" i]',
          'select[id*="education_end_date_year" i]',
          'select[name*="year" i]',
        ], [yr]);
        await fillField(page, [
          'input[name*="end_date[year]" i]',
          'input[placeholder*="Graduation Year" i]',
          'input[placeholder*="Year" i]',
        ], yr);
      }
      if (profile.education?.graduationMonth) {
        const months = normalizeMonth(profile.education.graduationMonth);
        await selectOption(page, [
          'select[name*="end_date[month]" i]',
          'select[id*="education_end_date_month" i]',
          'select[name*="month" i]',
        ], months);
        await fillField(page, [
          'input[name*="end_date[month]" i]',
          'input[placeholder*="Graduation Month" i]',
          'input[placeholder*="Month" i]',
        ], months[0]);
      }

      // 7. Work Authorization & Compliance standard dropdowns
      await selectOption(page, ['select[name*="authorized" i]', 'select[id*="authorized" i]'], ["Yes", "true"]);
      await selectOption(page, ['select[name*="sponsorship" i]', 'select[id*="sponsorship" i]'], ["No", "false"]);

      // Relocation
      const relocatePreferred = profile.willingToRelocate === false ? ["No", "false"] : ["Yes", "true"];
      await selectOption(page, [
        'select[name*="relocate" i]',
        'select[id*="relocate" i]',
        'select[name*="relocation" i]',
      ], relocatePreferred);

      // Commute / Onsite / Hybrid
      await selectOption(page, [
        'select[name*="commute" i]',
        'select[id*="commute" i]',
        'select[name*="onsite" i]',
        'select[id*="onsite" i]',
        'select[name*="hybrid" i]',
      ], ["Yes", "true"]);

      // Legal age (18+)
      await selectOption(page, [
        'select[name*="18" i]',
        'select[id*="18" i]',
        'select[name*="legal_age" i]',
      ], ["Yes", "true"]);

      // 8. EEO Demographics standard defaults
      await selectOption(page, ['select[name*="gender" i]', 'select[id*="gender" i]'], [profile.demographics?.gender || "Decline", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="race" i]', 'select[id*="race" i]'], [profile.demographics?.race || "Decline", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="veteran" i]', 'select[id*="veteran" i]'], [profile.demographics?.veteran || "Decline", "not a protected", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="disability" i]', 'select[id*="disability" i]'], [profile.demographics?.disability || "Decline", "No, I do not", "Decline to Self-Identify"]);

      // 9. General Question Answering (custom text inputs/comboboxes for right to work, legal name, referral, etc.)
      await answerGeneralQuestions(page, profile, "greenhouse");

      // 10. Submit or Dry-run
      if (dryRun) {
        if (!isHeadless) {
          await page.waitForTimeout(4000);
        }
        await browser.close();
        return { success: true, dryRun: true, message: "Dry-run: Greenhouse form filled successfully" };
      }

      const submitBtn = await page.$(
        'button[type="submit"], input[type="submit"], button#submit_app, button:has-text("Submit Application")'
      );
      if (!submitBtn) {
        await browser.close();
        return { success: false, error: "Submit button not found on Greenhouse application form" };
      }

      await submitBtn.click();

      // Check success or errors
      let success = false;
      let confirmationUrl = page.url();
      let errorReason = "";

      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        confirmationUrl = page.url();
        const content = (await page.content()).toLowerCase();
        if (
          confirmationUrl.includes("confirmation") ||
          confirmationUrl.includes("applied") ||
          content.includes("thank you for applying") ||
          content.includes("application submitted") ||
          content.includes("we've received your application") ||
          content.includes("application has been submitted")
        ) {
          success = true;
          break;
        }

        const errorEl = await page.$('.error, .error-message, [class*="error" i], [aria-invalid="true"], #error_message, .alert-danger');
        if (errorEl && (await errorEl.isVisible())) {
          const text = (await errorEl.innerText()).trim();
          if (text) {
            errorReason = text;
            break;
          }
        }
      }

      if (!success) {
        if (!errorReason) {
          const invalidInputs = await page.$$('[aria-invalid="true"], :invalid, input.error');
          if (invalidInputs.length > 0) {
            errorReason = "Form validation failed — required fields may be incomplete or invalid";
          } else {
            errorReason = "Application did not navigate to confirmation page after submission";
          }
        }
        if (!isHeadless) await page.waitForTimeout(3000);
        await browser.close();
        return { success: false, error: errorReason };
      }

      if (!isHeadless) await page.waitForTimeout(2000);
      await browser.close();
      return { success: true, confirmationUrl };

    } else if (platform === "ashby") {
      // Ashby form fields
      // 1. Name
      await fillField(page, [
        'input[name="_systemfield_name"]',
        'input[name*="name" i]',
        'input[placeholder*="Name" i]',
      ], `${profile.firstName} ${profile.lastName}`);

      // 2. Email & Phone
      await fillField(page, [
        'input[name="_systemfield_email"]',
        'input[type="email"]',
        'input[name*="email" i]',
      ], profile.email);

      await fillField(page, [
        'input[name="_systemfield_phone"]',
        'input[type="tel"]',
        'input[name*="phone" i]',
      ], profile.phone);

      // 3. Resume
      if (resumeExists) {
        let fileInput = await page.$('#_systemfield_resume, input[id*="resume" i], input[name*="resume" i]');
        if (!fileInput) {
          const allFileInputs = await page.$$('input[type="file"]');
          for (const fi of allFileInputs) {
            const id = ((await fi.getAttribute("id")) || "").toLowerCase();
            const name = ((await fi.getAttribute("name")) || "").toLowerCase();
            if (id.includes("resume") || name.includes("resume")) {
              fileInput = fi;
              break;
            }
          }
          if (!fileInput && allFileInputs.length > 0) {
            fileInput = allFileInputs[allFileInputs.length - 1];
          }
        }
        if (fileInput) {
          await fileInput.setInputFiles(profile.resumePath);
          await page.waitForTimeout(3000);
        }
      }

      // 4. Links
      await findAndFillLink(page, "linkedin", profile.linkedinUrl);
      await findAndFillLink(page, "github", profile.githubUrl, profile.githubOnlyIfRequired);
      await findAndFillLink(page, "portfolio", profile.portfolioUrl) ||
        await findAndFillLink(page, "website", profile.portfolioUrl);

      // 5. School / Education in Ashby
      if (profile.education?.school) {
        await fillField(page, ['input[name*="school" i]', 'input[placeholder*="School" i]'], profile.education.school);
      }
      if (profile.education?.degree) {
        await fillField(page, ['input[name*="degree" i]', 'input[placeholder*="Degree" i]'], profile.education.degree);
      }
      if (profile.education?.discipline) {
        await fillField(page, ['input[name*="discipline" i]', 'input[name*="major" i]'], profile.education.discipline);
      }
      if (profile.education?.graduationYear) {
        const yr = String(profile.education.graduationYear);
        await fillField(page, ['input[name*="graduation_year" i]', 'input[placeholder*="Graduation Year" i]', 'input[name*="graduation" i]'], yr);
      }
      if (profile.education?.graduationMonth) {
        const months = normalizeMonth(profile.education.graduationMonth);
        await fillField(page, ['input[name*="graduation_month" i]', 'input[placeholder*="Graduation Month" i]'], months[0]);
      }

      // 6. Work auth, relocation, and compliance radios/buttons in Ashby
      const relocateYes = profile.willingToRelocate !== false;
      const authYes = profile.workAuthorization?.authorizedInUS !== false;
      const sponsorshipYes = profile.workAuthorization?.requiresSponsorship === true;
      try {
        const allButtons = await page.$$('button:has-text("Yes"), button:has-text("No"), label:has-text("Yes"), label:has-text("No")');
        for (const btn of allButtons) {
          const text = (await btn.innerText()).trim();
          const parentText = await btn.evaluate(el => el.closest('div')?.textContent || '');
          const pLower = parentText.toLowerCase();

          if (pLower.includes('authorized to work') || pLower.includes('right to work') || pLower.includes('onsite') || pLower.includes('commute') || pLower.includes('18 years') || pLower.includes('hybrid') || pLower.includes('in-office')) {
            if (authYes && text.toLowerCase().includes('yes')) await btn.click();
            if (!authYes && text.toLowerCase().includes('no')) await btn.click();
          } else if (pLower.includes('relocate') || pLower.includes('relocation')) {
            if (relocateYes && text.toLowerCase().includes('yes')) await btn.click();
            if (!relocateYes && text.toLowerCase().includes('no')) await btn.click();
          } else if (pLower.includes('sponsorship')) {
            if (!sponsorshipYes && text.toLowerCase().includes('no')) await btn.click();
            if (sponsorshipYes && text.toLowerCase().includes('yes')) await btn.click();
          } else if (pLower.includes('previously worked') || pLower.includes('former employee') || pLower.includes('non-compete')) {
            if (text.toLowerCase().includes('no')) await btn.click();
          }
        }
      } catch {}

      // 7. General Question Answering for Ashby
      await answerGeneralQuestions(page, profile, "ashby");

      if (dryRun) {
        if (!isHeadless) {
          await page.waitForTimeout(4000);
        }
        await browser.close();
        return { success: true, dryRun: true, message: "Dry-run: Ashby form filled successfully" };
      }

      const submitBtn = await page.$(
        '.ashby-application-form-submit-button, button[type="submit"], button:has-text("Submit Application"), button:has-text("Apply")'
      );
      if (!submitBtn) {
        await browser.close();
        return { success: false, error: "Submit button not found on Ashby application form" };
      }

      // Listen for GraphQL response
      let graphQlError = "";
      page.on("response", async (response) => {
        try {
          if (response.url().includes("ApiSubmitSingleApplicationFormAction")) {
            const data = await response.json();
            if (data.errors && data.errors.length > 0) {
              graphQlError = data.errors.map(e => e.message).join("; ");
            }
          }
        } catch {}
      });

      await submitBtn.click();

      let success = false;
      let confirmationUrl = page.url();
      let errorReason = "";

      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(1000);
        confirmationUrl = page.url();
        const content = (await page.content()).toLowerCase();

        if (
          confirmationUrl.includes("confirmation") ||
          confirmationUrl.includes("applied") ||
          content.includes("thank you") ||
          content.includes("application submitted") ||
          content.includes("we have received your application") ||
          content.includes("application has been submitted")
        ) {
          success = true;
          break;
        }

        if (graphQlError) {
          errorReason = graphQlError;
          break;
        }

        const errorEl = await page.$('[role="alert"], [class*="error" i], [class*="errorMessage" i], [aria-invalid="true"]');
        if (errorEl && (await errorEl.isVisible())) {
          const text = (await errorEl.innerText()).trim();
          if (text) {
            errorReason = text;
            break;
          }
        }
      }

      if (!success) {
        if (!errorReason) {
          errorReason = graphQlError || "Application did not navigate to confirmation page after submission";
        }
        if (!isHeadless) await page.waitForTimeout(3000);
        await browser.close();
        return { success: false, error: errorReason };
      }

      if (!isHeadless) await page.waitForTimeout(2000);
      await browser.close();
      return { success: true, confirmationUrl };
    }

    await browser.close();
    return { success: false, error: `Unsupported platform: ${platform}` };
  } catch (err) {
    try { await browser.close(); } catch {}
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// CLI entrypoint when executed via `node playwright-runner.cjs`
if (require.main === module) {
  let inputData = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { inputData += chunk; });
  process.stdin.on("end", async () => {
    try {
      const payload = JSON.parse(inputData);
      const result = await runAutoApply(payload);
      console.log(JSON.stringify(result));
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      console.error(JSON.stringify({ success: false, error: err.message }));
      process.exit(1);
    }
  });
}

module.exports = { runAutoApply };
