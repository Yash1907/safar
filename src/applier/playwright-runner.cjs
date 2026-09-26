const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  FieldCategory,
  classifyField,
  resolveFieldValue,
  getDegreeOptionCandidates,
} = require("./field-classifier.cjs");

async function fillField(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible())) {
        await el.fill(value);
        return true;
      }
    } catch {}
  }
  return false;
}

function normalizeChoice(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bestOptionIndex(optionTexts, preferredValues) {
  const texts = optionTexts.map(normalizeChoice);
  const preferences = preferredValues.map(normalizeChoice).filter(Boolean);

  for (const preferred of preferences) {
    const exact = texts.findIndex((text) => text === preferred);
    if (exact >= 0) return exact;
    if (preferred === "yes" || preferred === "no") {
      const booleanMatch = texts.findIndex((text) => text.startsWith(`${preferred} `));
      if (booleanMatch >= 0) return booleanMatch;
    }
  }

  let bestIndex = -1;
  let bestScore = 0;
  for (const preferred of preferences) {
    if (preferred.length < 3) continue;
    const wantedTokens = new Set(preferred.split(" ").filter((token) => token.length > 2));
    for (let index = 0; index < texts.length; index++) {
      const text = texts[index];
      if (!text || /^(no options?|no results?)\b/.test(text)) continue;
      if (text.includes(preferred) || preferred.includes(text)) return index;
      const candidateTokens = new Set(text.split(" ").filter((token) => token.length > 2));
      const overlap = [...wantedTokens].filter((token) => candidateTokens.has(token)).length;
      const coverage = wantedTokens.size ? overlap / wantedTokens.size : 0;
      const precision = candidateTokens.size ? overlap / candidateTokens.size : 0;
      const score = coverage * 0.8 + precision * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }
  return bestScore >= 0.55 ? bestIndex : -1;
}

async function visibleOptionsForInput(page, input) {
  const controlsId = await input.getAttribute("aria-controls").catch(() => null);
  const menus = [];
  if (controlsId) {
    const escapedId = controlsId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const controlled = await page.$(`[id="${escapedId}"]`).catch(() => null);
    if (controlled) menus.push(controlled);
  }
  for (const candidate of await page.$$(
    ".select__menu, [role='listbox'], ul.ui-autocomplete, [class*='autocomplete-list'], .pac-container",
  )) {
    if (!menus.includes(candidate)) menus.push(candidate);
  }
  for (let index = menus.length - 1; index >= 0; index--) {
    const menu = menus[index];
    if (!(await menu.isVisible().catch(() => false))) continue;
    const options = await menu.$$(
      ".select__option, [role='option'], li.ui-menu-item, .pac-item, li",
    );
    if (options.length) return options;
  }
  return [];
}

async function selectSearchableOption(page, input, queryValues, preferredValues = queryValues) {
  const queries = [...new Set(queryValues.filter(Boolean).map(String))];
  for (const query of queries) {
    await input.click({ timeout: 2000 }).catch(() => {});
    await input.fill(query).catch(() => {});
    await page.waitForTimeout(350);
    const options = await visibleOptionsForInput(page, input);
    const optionTexts = await Promise.all(
      options.map(async (option) => ((await option.innerText().catch(() => "")) || "").trim()),
    );
    const foundIndex = bestOptionIndex(optionTexts, preferredValues);
    if (foundIndex >= 0 && options[foundIndex]) {
      await options[foundIndex].click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  await input.fill("").catch(() => {});
  return false;
}

async function isCustomCombobox(input) {
  return input.evaluate((el) =>
    el.getAttribute("role") === "combobox" ||
    el.getAttribute("aria-autocomplete") === "list" ||
    Boolean(el.getAttribute("aria-controls")) ||
    Boolean(el.closest(".select__control")),
  );
}

async function selectAnyOption(page, targetElOrSelector, preferredValues) {
  try {
    const el = typeof targetElOrSelector === "string" ? await page.$(targetElOrSelector) : targetElOrSelector;
    if (!el || !(await el.isVisible())) return false;

    const isStandardSelect = await el.evaluate((e) => e.tagName === "SELECT");
    if (isStandardSelect) {
      const options = await el.$$eval("option", (opts) =>
        opts.map((o) => ({ value: o.value, text: o.text.trim() }))
      );
      const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      for (const pref of preferredValues) {
        if (!pref) continue;
        const pLower = normalize(pref);
        let match = options.find((o) => normalize(o.text) === pLower || normalize(o.value) === pLower);
        if (!match && (pLower === "yes" || pLower === "no")) {
          match = options.find((o) => normalize(o.text).startsWith(`${pLower} `));
        }
        if (!match && pLower.length > 2) {
          match = options.find((o) => {
            const text = normalize(o.text);
            const value = normalize(o.value);
            return text.includes(pLower) || pLower.includes(text) || value.includes(pLower);
          });
        }
        if (match) {
          await el.selectOption(match.value);
          return true;
        }
      }
      return false;
    }

    // Searchable combobox or react-select. Query each candidate because many
    // Greenhouse controls do not load options until text has been entered.
    const isInput = await el.evaluate((e) => e.tagName === "INPUT");
    if (isInput) {
      return await selectSearchableOption(page, el, preferredValues, preferredValues);
    }

    // Non-searchable custom select.
    const control = await el.evaluateHandle((e) => {
      return e.closest(".select__control") || e.closest("[class*='select']") || e;
    });

    await control.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);

    const menus = await page.$$(".select__menu, [role='listbox']");
    let menu = null;
    for (const candidate of menus) {
      if (await candidate.isVisible().catch(() => false)) {
        menu = candidate;
        break;
      }
    }
    if (menu) {
      const options = await menu.$$(".select__option, [role='option']");
      const optionTexts = await Promise.all(
        options.map(async (option) => ((await option.innerText().catch(() => "")) || "").trim()),
      );
      const foundIndex = bestOptionIndex(optionTexts, preferredValues);

      if (foundIndex >= 0 && options[foundIndex]) {
        await options[foundIndex].click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(200);
        return true;
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
      if (el && (await el.isVisible())) {
        const ok = await selectAnyOption(page, el, preferredValues);
        if (ok) return true;
      }
    } catch {}
  }
  return false;
}

async function fillSchoolAutocomplete(page, input, schoolName) {
  if (!schoolName) return false;
  try {
    const requiresSelection = await isCustomCombobox(input);
    const normalized = normalizeChoice(schoolName);
    const firstDistinctiveWord = normalized
      .split(" ")
      .find((word) => word.length > 3 && !["university", "college", "state"].includes(word));
    const selected = await selectSearchableOption(
      page,
      input,
      [schoolName, firstDistinctiveWord],
      [schoolName],
    );
    if (selected || requiresSelection) return selected;
    await input.fill(schoolName);
    return true;
  } catch {
    return false;
  }
}

const US_STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

async function fillLocationAutocomplete(page, selectors, address) {
  const city = address?.city || "";
  const state = address?.state || "";
  if (!city && !state) return false;
  const fullState = US_STATE_NAMES[String(state).trim().toUpperCase()] || state;
  const preferred = [city, fullState, address?.country].filter(Boolean).join(", ");
  const queries = [
    [city, fullState].filter(Boolean).join(", "),
    [city, state].filter(Boolean).join(", "),
    city,
  ].filter(Boolean);
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible())) {
        return await selectSearchableOption(page, el, queries, [preferred, queries[0]]);
      }
    } catch {}
  }
  return false;
}

async function selectBooleanRadioOrButton(container, preferredBoolean) {
  const targetText = preferredBoolean ? "yes" : "no";
  try {
    // 1. Radio inputs inside container
    const radios = await container.$$('input[type="radio"]');
    for (const r of radios) {
      const labelText = await r.evaluate((el) => {
        const p = el.closest("label");
        if (p) return p.textContent;
        if (el.id) {
          const l = document.querySelector(`label[for="${el.id}"]`);
          if (l) return l.textContent;
        }
        return el.value;
      });
      const l = (labelText || "").toLowerCase();
      if (
        (targetText === "yes" && (l.includes("yes") || l === "1" || l === "true")) ||
        (targetText === "no" && (l.includes("no") || l === "0" || l === "false"))
      ) {
        await r.click({ force: true }).catch(() => {});
        return true;
      }
    }

    // 2. Ashby buttons or pill radio buttons
    const buttons = await container.$$('button:not([type="submit"]), [role="radio"]');
    for (const b of buttons) {
      const bText = (await b.innerText()).trim().toLowerCase();
      if (
        (targetText === "yes" && (bText === "yes" || bText.startsWith("yes"))) ||
        (targetText === "no" && (bText === "no" || bText.startsWith("no")))
      ) {
        await b.click().catch(() => {});
        return true;
      }
    }
  } catch {}
  return false;
}

async function answerGeneralQuestions(page, profile, platform, roleType) {
  const containerSelector =
    platform === "ashby"
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
        labelText = await f.evaluate(
          (el) => el.getAttribute("aria-label") || el.innerText.split("\n")[0] || ""
        );
      }
      if (!labelText) continue;
      const l = labelText.toLowerCase().replace(/\s+/g, " ");

      // Run semantic classifier
      const classification = classifyField(labelText);
      const category = classification.category;
      const resolved = resolveFieldValue(category, profile, roleType, { label: labelText });

      // If resolved has a boolean value, check if container has radio buttons or button pills first
      if (resolved && resolved.booleanVal !== undefined) {
        const handled = await selectBooleanRadioOrButton(f, resolved.booleanVal);
        if (handled) continue;
      }

      const input = await f.$(
        "input:not([type='hidden']):not([type='file']):not([type='submit']), select, textarea"
      );
      if (!input || !(await input.isVisible())) {
        if (resolved && resolved.booleanVal !== undefined) {
          await selectBooleanRadioOrButton(f, resolved.booleanVal);
        }
        continue;
      }

      // Check if already filled
      const isFilled = await input.evaluate((el, cont) => {
        if (el.type === "radio") {
          const radios = cont ? cont.querySelectorAll('input[type="radio"]') : [];
          if (radios.length > 0) return Array.from(radios).some((r) => r.checked);
          return el.checked;
        }
        if (el.type === "checkbox") {
          return el.checked;
        }
        if (el.tagName === "SELECT") return el.selectedIndex > 0 && el.value !== "";
        const isCombobox = el.getAttribute("role") === "combobox" || !!el.closest(".select__control");
        if (isCombobox) {
          const control = el.closest(".select__control") || cont;
          const selected = control?.querySelector(
            "[aria-selected='true'], [class*='singleValue'], [class*='selectedValue'], [data-value]",
          );
          return Boolean(selected && (selected.textContent || selected.getAttribute("data-value"))?.trim());
        }
        if (el.value && el.value.trim().length > 0) return true;
        return false;
      }, f);
      if (isFilled) continue;

      const inputType = await input.getAttribute("type");
      const isCombobox = await input.evaluate(
        (el) =>
          el.getAttribute("role") === "combobox" ||
          el.tagName === "SELECT" ||
          !!el.closest(".select__control")
      );

      // 1. Semantic resolution
      if (resolved && (category !== FieldCategory.UNKNOWN || resolved.custom)) {
        if (inputType === "checkbox") {
          if (resolved.booleanVal !== false) {
            await input.check().catch(() => input.click().catch(() => {}));
          }
          continue;
        }

        if (category === FieldCategory.EDU_SCHOOL) {
          if (isCombobox) {
            const ok = await selectAnyOption(page, input, [resolved.text]);
            if (!ok) await fillSchoolAutocomplete(page, input, resolved.text);
          } else {
            await fillSchoolAutocomplete(page, input, resolved.text);
          }
          continue;
        }

        if (category === FieldCategory.EDU_DEGREE) {
          if (isCombobox) {
            await selectAnyOption(page, input, resolved.optionCandidates);
          } else {
            await input.fill(resolved.text);
          }
          continue;
        }

        if (category === FieldCategory.EDU_MAJOR) {
          if (isCombobox) {
            await selectAnyOption(page, input, resolved.optionCandidates);
          } else {
            await input.fill(resolved.text);
          }
          continue;
        }

        if (category === FieldCategory.EDU_GPA) {
          await input.fill(resolved.text);
          continue;
        }

        if (
          category === FieldCategory.EDU_GRAD_DATE ||
          category === FieldCategory.EDU_START_YEAR ||
          category === FieldCategory.EDU_START_MONTH ||
          category === FieldCategory.EDU_GRAD_YEAR ||
          category === FieldCategory.EDU_GRAD_MONTH
        ) {
          if (isCombobox) {
            await selectAnyOption(page, input, resolved.optionCandidates);
          } else if (inputType === "date") {
            await input.fill(formatDateForPicker(resolved.text));
          } else {
            await input.fill(resolved.text);
          }
          continue;
        }

        if (category === FieldCategory.SIGNATURE || category === FieldCategory.CONTACT_FULL_NAME) {
          await input.fill(resolved.text);
          continue;
        }

        if (category === FieldCategory.DATE_TODAY) {
          if (inputType === "date") {
            await input.fill(resolved.text);
          } else {
            await input.fill(resolved.formattedDate || resolved.text);
          }
          continue;
        }

        if (category === FieldCategory.COMPENSATION_SALARY) {
          const numericOnly = /numeric|number|digits|without\s*special\s*char/i.test(l);
          if (inputType === "number" || numericOnly) {
            let numVal = resolved.numericText || "";
            if (!numVal) {
              const req = await isFieldRequired(page, input);
              if (req) numVal = "0";
            }
            if (numVal) await input.fill(numVal);
          } else if (!isCombobox) {
            await input.fill(resolved.text);
          }
          continue;
        }

        if (resolved.optionCandidates && resolved.optionCandidates.length > 0) {
          if (isCombobox) {
            await selectAnyOption(page, input, resolved.optionCandidates);
          } else {
            await input.fill(resolved.optionCandidates[0]);
          }
          continue;
        }

        if (resolved.text) {
          if (isCombobox) {
            await selectAnyOption(page, input, [resolved.text]);
          } else {
            await input.fill(resolved.text);
          }
          continue;
        }
      }

      // 2. Pattern-based fallback handlers
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
      else if (/right\s*to\s*work|authorized\s*to\s*work|eligible\s*to\s*work|legal\s*right|work\s*authori[sz]ation|lawfully\s*authorized/i.test(l)) {
        const preferred = profile.workAuthorization?.authorizedInUS === false ? ["No", "false"] : ["Yes", "true"];
        if (isCombobox) {
          await selectAnyOption(page, input, preferred);
        } else {
          await input.fill(preferred[0]);
        }
      }
      else if (/sponsorship|visa\s*sponsorship/i.test(l)) {
        const preferred = profile.workAuthorization?.requiresSponsorship ? ["Yes", "true"] : ["No", "false"];
        if (isCombobox) {
          await selectAnyOption(page, input, preferred);
        } else {
          await input.fill(preferred[0]);
        }
      }
      else if (/full\s*legal\s*name|legal\s*name.*surname|middle\s*name|signature/i.test(l)) {
        if (isCombobox) {
          await selectAnyOption(page, input, ["Yes", "true"]);
        } else {
          await input.fill(`${profile.firstName} ${profile.lastName}`);
        }
      }
      else if (/hear\s*about|connect(ed)?\s*with\s*us|source|referral|learn\s*about/i.test(l)) {
        const source = profile.answers?.referralSource;
        if (source) {
          if (isCombobox) {
            await selectAnyOption(page, input, [source]);
          } else {
            await input.fill(source);
          }
        }
      }
      else if (/relocat/i.test(l)) {
        const preferred = profile.willingToRelocate === false ? ["No", "false"] : ["Yes", "true"];
        if (isCombobox) {
          await selectAnyOption(page, input, preferred);
        } else {
          await input.fill(preferred[0]);
        }
      }
      else if (/commute|onsite|in-?office|hybrid|days?\s*(a|per)\s*week|work\s*(out\s*of|from)\s*our\s*.*office/i.test(l)) {
        const onsite = profile.answers?.willingOnsite;
        if (onsite !== undefined) {
          const preferred = onsite ? ["Yes", "true"] : ["No", "false"];
          if (isCombobox) {
            await selectAnyOption(page, input, preferred);
          } else {
            await input.fill(preferred[0]);
          }
        }
      }
      else if (/18\s*(years|or\s*older|\+)|at\s*least\s*18|legal\s*age/i.test(l)) {
        const over18 = profile.answers?.over18;
        if (over18 !== undefined) {
          const preferred = over18 ? ["Yes", "true"] : ["No", "false"];
          if (isCombobox) {
            await selectAnyOption(page, input, preferred);
          } else {
            await input.fill(preferred[0]);
          }
        }
      }
      else if (/start\s*date|earliest\s*(start|availab\w*|avaiabl\w*)|available\s*to\s*start|when.*(start|begin)/i.test(l)) {
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
      else if (/notice\s*period/i.test(l)) {
        const notice = profile.answers?.noticePeriod;
        if (notice) {
          if (isCombobox) {
            await selectAnyOption(page, input, [notice]);
          } else {
            await input.fill(notice);
          }
        }
      }
      else if (/previously\s*(worked|employed|applied)|former\s*employee|ever\s*worked\s*at|deloitte|pwc|ey|kpmg/i.test(l)) {
        const previous = profile.answers?.previousEmployee;
        if (previous !== undefined) {
          const preferred = previous ? ["Yes", "true"] : ["No", "false"];
          if (isCombobox) {
            await selectAnyOption(page, input, preferred);
          } else {
            await input.fill(preferred[0]);
          }
        }
      }
      else if (/non-?compete|restrictive\s*covenant/i.test(l)) {
        const nonCompete = profile.answers?.subjectToNonCompete;
        if (nonCompete !== undefined) {
          const preferred = nonCompete ? ["Yes", "true"] : ["No", "None", "false"];
          if (isCombobox) {
            await selectAnyOption(page, input, preferred);
          } else {
            await input.fill(preferred[0]);
          }
        }
      }
      else if (/desired\s*salary|target\s*compensation|salary\s*expectation|compensation/i.test(l)) {
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
      else if (/brighthire|interview.*record|consent.*record|record.*interview|record(ed)?|consent|agree.*terms|terms.*condition|privacy\s*policy|certify|affirm|accurate/i.test(l)) {
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
      else if (/if\s*you\s*selected\s*.*other|please\s*specify/i.test(l)) {
        if (!isCombobox) {
          await input.fill("N/A");
        }
      }
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

/**
 * Read back the values actually present in the form. A fill call resolving
 * does not guarantee that a React control accepted or retained the value.
 */
async function auditForm(page) {
  const rawFields = await page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const labelFor = (el) => {
      if (
        (el.getAttribute("type") || "").toLowerCase() === "radio" ||
        (el.getAttribute("role") || "").toLowerCase() === "radio"
      ) {
        const group = el.closest("fieldset, [role='radiogroup'], [role='group'], [class*='fieldEntry'], .field, .form-group");
        const candidates = group
          ? Array.from(group.querySelectorAll("legend, label, [class*='label']"))
              .map((node) => clean(node.textContent))
              .filter((text) => text && !/^(yes|no|true|false)$/i.test(text))
          : [];
        if (candidates.length) return candidates[0];
      }
      const nativeLabels = el.labels ? Array.from(el.labels).map((label) => label.textContent).filter(Boolean) : [];
      if (nativeLabels.length) return clean(nativeLabels.join(" "));

      const labelledBy = clean(el.getAttribute("aria-labelledby"));
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || "")
          .filter(Boolean)
          .join(" ");
        if (text) return clean(text);
      }

      const direct = el.getAttribute("aria-label") || el.getAttribute("placeholder");
      if (direct) return clean(direct);

      const fieldset = el.closest("fieldset");
      const legend = fieldset?.querySelector("legend");
      if (legend?.textContent) return clean(legend.textContent);

      const container = el.closest(
        "[class*='fieldEntry'], .field, [class*='field'], .form-group, [role='group'], div:has(> label)",
      );
      const label = container?.querySelector("label");
      if (label?.textContent) return clean(label.textContent);
      return clean(container?.textContent || el.name || el.id || el.type || el.tagName);
    };

    const controls = Array.from(
      document.querySelectorAll(
        "input:not([type='hidden']):not([type='submit']):not([type='button']), select, textarea, [role='combobox'], [role='radio'], [role='checkbox']",
      ),
    ).filter((el) => !el.disabled && (el.type === "file" || visible(el)));

    const seen = new Set();
    const result = [];
    for (const el of controls) {
      const type = (el.getAttribute("type") || el.tagName || "").toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      const label = labelFor(el);
      const container = el.closest(
        "[class*='fieldEntry'], .field, [class*='field'], .form-group, [role='group'], fieldset, div:has(> label)",
      );
      const containerText = clean(container?.textContent || "");
      const required = Boolean(
        el.required ||
        el.getAttribute("aria-required") === "true" ||
        container?.querySelector("[required], [aria-required='true'], .required") ||
        (/\*|\(required\)/i.test(containerText) && !/\(optional\)/i.test(containerText)),
      );

      let key = `${label}|${el.name || el.id || type}`;
      let value = "";
      let filled = false;
      if (type === "radio" || role === "radio") {
        const groupName = el.name;
        key = `${label}|radio|${groupName || containerText}`;
        const scope = container || document;
        const radios = type === "radio" && groupName
          ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`))
          : Array.from(scope.querySelectorAll('input[type="radio"], [role="radio"]'));
        const checked = radios.find((radio) => radio.checked || radio.getAttribute("aria-checked") === "true");
        if (checked) {
          const optionLabel = checked.labels
            ? Array.from(checked.labels).map((node) => clean(node.textContent)).find(Boolean)
            : "";
          value = clean(optionLabel || checked.value);
          filled = true;
        }
      } else if (type === "checkbox" || role === "checkbox") {
        const checked = el.checked || el.getAttribute("aria-checked") === "true";
        value = checked ? clean(label || el.value || el.textContent || "Yes") : "";
        filled = Boolean(checked);
      } else if (type === "file") {
        value = Array.from(el.files || []).map((file) => file.name).join(", ");
        filled = Boolean(value);
      } else if (el.tagName === "SELECT") {
        const option = el.options[el.selectedIndex];
        value = clean(option?.textContent || el.value);
        filled = Boolean(el.value && !/^(select|choose|please select|--)/i.test(value));
      } else {
        const isCombobox = el.getAttribute("role") === "combobox" || Boolean(el.closest(".select__control"));
        if (isCombobox) {
          const control = el.closest(".select__control") || container;
          const selected = control?.querySelector(
            "[aria-selected='true'], [class*='singleValue'], [class*='selectedValue'], [data-value]",
          );
          value = clean(selected?.textContent || selected?.getAttribute("data-value") || "");
        } else {
          value = clean(el.value);
        }
        filled = Boolean(value);
      }

      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        label,
        value,
        id: el.id || "",
        name: el.name || "",
        required,
        filled,
        type,
        valid: typeof el.checkValidity === "function" ? el.checkValidity() : true,
      });
    }

    // Greenhouse replaces a successfully uploaded file input with a filename
    // marker. Preserve that marker in the audit so a real upload can pass and
    // a still-empty resume input cannot be mistaken for success.
    for (const upload of document.querySelectorAll(".file-upload")) {
      const filenameNode = upload.querySelector(".file-upload__filename p, .file-upload__filename");
      const filename = clean(filenameNode?.textContent || "");
      if (!filename) continue;
      const uploadText = clean(upload.textContent || "");
      const filenameIndex = uploadText.indexOf(filename);
      const label = clean(filenameIndex >= 0 ? uploadText.slice(0, filenameIndex) : uploadText);
      const key = `${label}|uploaded-file`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        label,
        value: filename,
        id: /resume/i.test(label) ? "resume-uploaded" : "uploaded-file",
        name: "",
        required: /\*|\(required\)/i.test(label),
        filled: true,
        type: "file",
        valid: true,
      });
    }
    return result;
  });

  const importantCategories = new Set([
    FieldCategory.CONTACT_FIRST_NAME,
    FieldCategory.CONTACT_PREFERRED_NAME,
    FieldCategory.CONTACT_LAST_NAME,
    FieldCategory.CONTACT_FULL_NAME,
    FieldCategory.CONTACT_EMAIL,
    FieldCategory.DOC_RESUME,
  ]);

  const fields = rawFields.map((field) => {
    const identifier = `${field.id} ${field.name}`.toLowerCase();
    const classification = field.type === "file" && identifier.includes("resume")
      ? { category: FieldCategory.DOC_RESUME }
      : classifyField(field.label);
    const important =
      classification.category.startsWith("EDU_") || importantCategories.has(classification.category);
    return {
      ...field,
      label: classification.category === FieldCategory.DOC_RESUME && /^attach$/i.test(field.label)
        ? "Resume/CV"
        : field.label,
      category: classification.category,
      mustFill: field.required || important,
    };
  });

  const missing = fields.filter((field) => field.mustFill && (!field.filled || !field.valid));
  return { fields, missing };
}

function auditError(missing) {
  const details = missing
    .slice(0, 8)
    .map((field) => `"${field.label}"${field.category !== FieldCategory.UNKNOWN ? ` (${field.category})` : ""}`)
    .join(", ");
  return `Required form audit failed; missing or invalid fields: ${details}`;
}

async function fillDynamicQuestionsAndAudit(page, profile, platform, roleType) {
  await answerGeneralQuestions(page, profile, platform, roleType);
  await page.waitForTimeout(300);
  // The first answers may reveal dependent questions or rerender controls.
  await answerGeneralQuestions(page, profile, platform, roleType);
  await page.waitForTimeout(200);
  return auditForm(page);
}

async function launchBrowser(options) {
  const candidates = browserExecutableCandidates();
  let lastError;
  for (const executablePath of candidates) {
    try {
      return await chromium.launch({ ...options, executablePath });
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return chromium.launch(options);
}

function browserExecutableCandidates(preferred) {
  return [
    preferred,
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index && fs.existsSync(candidate));
}

function expandUserPath(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

async function launchSimplifyContext(simplify, options) {
  const userDataDir = expandUserPath(simplify.userDataDir);
  fs.mkdirSync(userDataDir, { recursive: true });
  const candidates = browserExecutableCandidates(simplify.executablePath);
  let lastError;
  for (const executablePath of candidates) {
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        ...options,
        headless: false,
        executablePath,
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [...(options.args || []), "--enable-extensions"],
      });
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return chromium.launchPersistentContext(userDataDir, {
    ...options,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [...(options.args || []), "--enable-extensions"],
  });
}

async function clickFirstVisibleInFrames(page, selectors) {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        await locator.click({ timeout: 3000 }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

async function triggerSimplifyAutofill(page, timeoutMs) {
  const autofillSelectors = [
    'button:has-text("Autofill This Page")',
    '[role="button"]:has-text("Autofill This Page")',
    '[data-testid*="autofill" i]',
  ];
  const panelSelectors = [
    '[aria-label*="Simplify Copilot" i]',
    '[title*="Simplify Copilot" i]',
    '[data-testid*="simplify" i]',
  ];
  const deadline = Date.now() + Math.min(timeoutMs, 30_000);
  while (Date.now() < deadline) {
    if (await clickFirstVisibleInFrames(page, autofillSelectors)) return true;
    await clickFirstVisibleInFrames(page, panelSelectors);
    await page.waitForTimeout(500);
  }
  return false;
}

async function waitForSimplifyAudit(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastAudit = await auditForm(page);
  let stablePasses = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1200);
    lastAudit = await auditForm(page);
    if (lastAudit.missing.length === 0) {
      stablePasses++;
      if (stablePasses >= 3) return lastAudit;
    } else {
      stablePasses = 0;
    }
  }
  return lastAudit;
}

async function submitAndConfirm(page) {
  const submitBtn = await page.$(
    'button[type="submit"], input[type="submit"], button#submit_app, button:has-text("Submit Application"), button:has-text("Submit application")',
  );
  if (!submitBtn || !(await submitBtn.isVisible().catch(() => false))) {
    return { success: false, error: "Submit button not found on application form" };
  }
  await submitBtn.click();
  let confirmationUrl = page.url();
  for (let index = 0; index < 15; index++) {
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
      return { success: true, confirmationUrl };
    }
    const errorEl = await page.$(
      '.error, .error-message, [class*="error" i], [aria-invalid="true"], #error_message, .alert-danger',
    );
    if (errorEl && await errorEl.isVisible().catch(() => false)) {
      const message = ((await errorEl.innerText().catch(() => "")) || "").trim();
      if (message) return { success: false, error: message };
    }
  }
  return { success: false, error: "Application did not reach a confirmed submission page" };
}

async function runSimplifyFlow({ page, browser, simplify, dryRun }) {
  const timeoutMs = Math.max(10_000, simplify.autofillTimeoutMs || 60_000);
  const triggered = await triggerSimplifyAutofill(page, timeoutMs);
  if (!triggered) {
    await browser.close();
    return {
      success: false,
      error: `Simplify Copilot was not ready in browser profile ${expandUserPath(simplify.userDataDir)}. Install the extension, sign in, and enable access to application sites in this profile.`,
    };
  }

  const audit = await waitForSimplifyAudit(page, timeoutMs);
  if (audit.missing.length > 0) {
    await browser.close();
    return { success: false, error: auditError(audit.missing), fields: audit.fields };
  }
  if (dryRun) {
    await browser.close();
    return {
      success: true,
      dryRun: true,
      message: "Dry-run: Simplify autofill completed and every required field passed audit",
      fields: audit.fields,
    };
  }

  const submission = await submitAndConfirm(page);
  await browser.close();
  return { ...submission, fields: audit.fields };
}

async function runAutoApply({ url, platform, profile, dryRun, headless, roleType, simplify }) {
  const isHeadless = simplify ? false : headless !== false;
  const effectiveRoleType = roleType || (url.toLowerCase().includes("intern") ? "intern" : "fulltime");
  const launchArgs = isHeadless
    ? ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
    : ["--disable-blink-features=AutomationControlled", "--no-sandbox"];

  let browser;
  let context;
  if (simplify) {
    context = await launchSimplifyContext(simplify, {
      args: launchArgs,
      slowMo: 60,
      viewport: { width: 1280, height: 900 },
    });
    browser = { close: () => context.close() };
  } else {
    browser = await launchBrowser({
      headless: isHeadless,
      args: launchArgs,
      slowMo: isHeadless ? undefined : 60,
    });
    context = await browser.newContext({
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
  }

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    if (simplify) {
      return await runSimplifyFlow({ page, browser, simplify, dryRun });
    }

    if (!profile) {
      await browser.close();
      return { success: false, error: "Native application profile is missing" };
    }

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

      // 3. Location / Address (with autocomplete support for Google Places / Greenhouse combobox)
      if (profile.address?.city || profile.address?.state) {
        await fillLocationAutocomplete(page, [
          'input[name*="location" i]',
          'input[id*="location" i]',
          'input[id*="candidate_location" i]',
        ], profile.address);
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
        const schoolInput = await page.$('input[name*="school" i], input[id*="school" i]');
        if (schoolInput && (await schoolInput.isVisible())) {
          await fillSchoolAutocomplete(page, schoolInput, profile.education.school);
        } else {
          await fillField(page, ['input[name*="school" i]', 'input[id*="school" i]'], profile.education.school);
        }
      }
      if (profile.education?.degree) {
        const degreeCandidates = getDegreeOptionCandidates(profile.education.degree);
        const degreeInput = await page.$('input[name*="degree" i], input[id*="degree" i]');
        let selected = false;
        if (degreeInput && await degreeInput.isVisible()) {
          if (await isCustomCombobox(degreeInput)) {
            selected = await selectAnyOption(page, degreeInput, degreeCandidates);
          } else {
            await degreeInput.fill(profile.education.degree);
            selected = true;
          }
        }
        if (!selected) {
          await selectOption(page, ['select[name*="degree" i]', 'select[id*="degree" i]'], degreeCandidates);
        }
      }
      if (profile.education?.discipline) {
        const disciplineInput = await page.$('input[name*="discipline" i], input[id*="discipline" i]');
        let selected = false;
        if (disciplineInput && await disciplineInput.isVisible()) {
          if (await isCustomCombobox(disciplineInput)) {
            selected = await selectAnyOption(page, disciplineInput, [profile.education.discipline]);
          } else {
            await disciplineInput.fill(profile.education.discipline);
            selected = true;
          }
        }
        if (!selected) {
          await selectOption(page, ['select[name*="discipline" i]', 'select[id*="discipline" i]'], [profile.education.discipline]);
        }
      }
      if (profile.education?.gpa) {
        await fillField(page, [
          'input[name*="gpa" i]',
          'input[id*="gpa" i]',
          'input[placeholder*="gpa" i]',
          'input[aria-label*="gpa" i]',
        ], String(profile.education.gpa));
      }
      if (profile.education?.startYear) {
        const yr = String(profile.education.startYear);
        await selectOption(page, [
          'select[name*="start_date[year]" i]',
          'select[id*="education_start_date_year" i]',
        ], [yr]);
        await fillField(page, [
          'input[id^="start-year--" i]',
          'input[name*="start_date[year]" i]',
          'input[placeholder*="Start Year" i]',
        ], yr);
      }
      if (profile.education?.startMonth) {
        const months = normalizeMonth(profile.education.startMonth);
        const monthInput = await page.$(
          'input[id^="start-month--" i], input[name*="start_date[month]" i], input[placeholder*="Start Month" i]',
        );
        const selected = monthInput && await monthInput.isVisible()
          ? await selectAnyOption(page, monthInput, months)
          : false;
        if (!selected) {
          await selectOption(page, [
            'select[name*="start_date[month]" i]',
            'select[id*="education_start_date_month" i]',
          ], months);
        }
      }
      if (profile.education?.graduationYear) {
        const yr = String(profile.education.graduationYear);
        await selectOption(page, [
          'select[name*="end_date[year]" i]',
          'select[id*="education_end_date_year" i]',
          'select[name*="year" i]',
        ], [yr]);
        await fillField(page, [
          'input[id^="end-year--" i]',
          'input[name*="end_date[year]" i]',
          'input[placeholder*="Graduation Year" i]',
          'input[placeholder*="Year" i]',
        ], yr);
      }
      if (profile.education?.graduationMonth) {
        const months = normalizeMonth(profile.education.graduationMonth);
        const monthInput = await page.$(
          'input[id^="end-month--" i], input[name*="end_date[month]" i], input[placeholder*="Graduation Month" i]',
        );
        const selected = monthInput && await monthInput.isVisible()
          ? await selectAnyOption(page, monthInput, months)
          : false;
        if (!selected) {
          await selectOption(page, [
            'select[name*="end_date[month]" i]',
            'select[id*="education_end_date_month" i]',
            'select[name*="month" i]',
          ], months);
        }
      }

      // 7. Work Authorization & Compliance standard dropdowns
      const authPreferred = profile.workAuthorization?.authorizedInUS === false ? ["No", "false"] : ["Yes", "true"];
      const sponsorshipPreferred = profile.workAuthorization?.requiresSponsorship === true ? ["Yes", "true"] : ["No", "false"];
      await selectOption(page, ['select[name*="authorized" i]', 'select[id*="authorized" i]'], authPreferred);
      await selectOption(page, ['select[name*="sponsorship" i]', 'select[id*="sponsorship" i]'], sponsorshipPreferred);

      // Relocation
      const relocatePreferred = profile.willingToRelocate === false ? ["No", "false"] : ["Yes", "true"];
      await selectOption(page, [
        'select[name*="relocate" i]',
        'select[id*="relocate" i]',
        'select[name*="relocation" i]',
      ], relocatePreferred);

      // Commute / Onsite / Hybrid
      if (profile.answers?.willingOnsite !== undefined) {
        await selectOption(page, [
          'select[name*="commute" i]',
          'select[id*="commute" i]',
          'select[name*="onsite" i]',
          'select[id*="onsite" i]',
          'select[name*="hybrid" i]',
        ], profile.answers.willingOnsite ? ["Yes", "true"] : ["No", "false"]);
      }

      // Legal age (18+)
      if (profile.answers?.over18 !== undefined) {
        await selectOption(page, [
          'select[name*="18" i]',
          'select[id*="18" i]',
          'select[name*="legal_age" i]',
        ], profile.answers.over18 ? ["Yes", "true"] : ["No", "false"]);
      }

      // 8. EEO Demographics standard defaults
      await selectOption(page, ['select[name*="gender" i]', 'select[id*="gender" i]'], [profile.demographics?.gender || "Decline", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="race" i]', 'select[id*="race" i]'], [profile.demographics?.race || "Decline", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="veteran" i]', 'select[id*="veteran" i]'], [profile.demographics?.veteran || "Decline", "not a protected", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="disability" i]', 'select[id*="disability" i]'], [profile.demographics?.disability || "Decline", "No, I do not", "Decline to Self-Identify"]);

      // 9. General Question Answering (custom text inputs/comboboxes for right to work, legal name, referral, etc.)
      const audit = await fillDynamicQuestionsAndAudit(page, profile, "greenhouse", effectiveRoleType);
      if (audit.missing.length > 0) {
        if (!isHeadless) await page.waitForTimeout(3000);
        await browser.close();
        return { success: false, error: auditError(audit.missing), fields: audit.fields };
      }

      // 10. Submit or Dry-run
      if (dryRun) {
        if (!isHeadless) {
          await page.waitForTimeout(4000);
        }
        await browser.close();
        return { success: true, dryRun: true, message: "Dry-run: Greenhouse form filled and audited successfully", fields: audit.fields };
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
      return { success: true, confirmationUrl, fields: audit.fields };

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
        const schoolInput = await page.$('input[name*="school" i], input[placeholder*="School" i]');
        if (schoolInput && (await schoolInput.isVisible())) {
          await fillSchoolAutocomplete(page, schoolInput, profile.education.school);
        } else {
          await fillField(page, ['input[name*="school" i]', 'input[placeholder*="School" i]'], profile.education.school);
        }
      }
      if (profile.education?.degree) {
        const degreeCandidates = getDegreeOptionCandidates(profile.education.degree);
        const degreeInput = await page.$('input[name*="degree" i], input[placeholder*="Degree" i]');
        let selected = false;
        if (degreeInput && await degreeInput.isVisible()) {
          if (await isCustomCombobox(degreeInput)) {
            selected = await selectAnyOption(page, degreeInput, degreeCandidates);
          } else {
            await degreeInput.fill(profile.education.degree);
            selected = true;
          }
        }
        if (!selected) {
          await selectOption(page, ['select[name*="degree" i]'], degreeCandidates);
        }
      }
      if (profile.education?.discipline) {
        const disciplineInput = await page.$('input[name*="discipline" i], input[name*="major" i]');
        if (disciplineInput && await disciplineInput.isVisible()) {
          const isCombobox = await disciplineInput.getAttribute("role") === "combobox";
          if (isCombobox) {
            await selectAnyOption(page, disciplineInput, [profile.education.discipline]);
          } else {
            await disciplineInput.fill(profile.education.discipline);
          }
        }
      }
      if (profile.education?.gpa) {
        await fillField(page, [
          'input[name*="gpa" i]',
          'input[placeholder*="GPA" i]',
          'input[id*="gpa" i]',
          'input[aria-label*="gpa" i]',
        ], String(profile.education.gpa));
      }
      if (profile.education?.startYear) {
        await fillField(page, [
          'input[name*="start_year" i]',
          'input[id^="start-year--" i]',
          'input[placeholder*="Start Year" i]',
        ], String(profile.education.startYear));
      }
      if (profile.education?.startMonth) {
        const months = normalizeMonth(profile.education.startMonth);
        const startMonthInput = await page.$(
          'input[name*="start_month" i], input[id^="start-month--" i], input[placeholder*="Start Month" i]',
        );
        if (startMonthInput && await startMonthInput.isVisible()) {
          await selectAnyOption(page, startMonthInput, months);
        }
      }
      if (profile.education?.graduationYear) {
        const yr = String(profile.education.graduationYear);
        await fillField(page, [
          'input[name*="graduation_year" i]',
          'input[id^="end-year--" i]',
          'input[placeholder*="Graduation Year" i]',
          'input[name*="graduation" i]',
        ], yr);
      }
      if (profile.education?.graduationMonth) {
        const months = normalizeMonth(profile.education.graduationMonth);
        const endMonthInput = await page.$(
          'input[name*="graduation_month" i], input[id^="end-month--" i], input[placeholder*="Graduation Month" i]',
        );
        if (endMonthInput && await endMonthInput.isVisible()) {
          await selectAnyOption(page, endMonthInput, months);
        }
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

          if (pLower.includes('authorized to work') || pLower.includes('right to work')) {
            if (authYes && text.toLowerCase().includes('yes')) await btn.click();
            if (!authYes && text.toLowerCase().includes('no')) await btn.click();
          } else if (pLower.includes('onsite') || pLower.includes('commute') || pLower.includes('hybrid') || pLower.includes('in-office')) {
            const onsite = profile.answers?.willingOnsite;
            if (onsite === true && text.toLowerCase().includes('yes')) await btn.click();
            if (onsite === false && text.toLowerCase().includes('no')) await btn.click();
          } else if (pLower.includes('18 years') || pLower.includes('at least 18')) {
            const over18 = profile.answers?.over18;
            if (over18 === true && text.toLowerCase().includes('yes')) await btn.click();
            if (over18 === false && text.toLowerCase().includes('no')) await btn.click();
          } else if (pLower.includes('relocate') || pLower.includes('relocation')) {
            if (relocateYes && text.toLowerCase().includes('yes')) await btn.click();
            if (!relocateYes && text.toLowerCase().includes('no')) await btn.click();
          } else if (pLower.includes('sponsorship')) {
            if (!sponsorshipYes && text.toLowerCase().includes('no')) await btn.click();
            if (sponsorshipYes && text.toLowerCase().includes('yes')) await btn.click();
          } else if (pLower.includes('previously worked') || pLower.includes('former employee')) {
            const previous = profile.answers?.previousEmployee;
            if (previous === true && text.toLowerCase().includes('yes')) await btn.click();
            if (previous === false && text.toLowerCase().includes('no')) await btn.click();
          } else if (pLower.includes('non-compete')) {
            const nonCompete = profile.answers?.subjectToNonCompete;
            if (nonCompete === true && text.toLowerCase().includes('yes')) await btn.click();
            if (nonCompete === false && text.toLowerCase().includes('no')) await btn.click();
          }
        }
      } catch {}

      // 7. General Question Answering for Ashby
      const audit = await fillDynamicQuestionsAndAudit(page, profile, "ashby", effectiveRoleType);
      if (audit.missing.length > 0) {
        if (!isHeadless) await page.waitForTimeout(3000);
        await browser.close();
        return { success: false, error: auditError(audit.missing), fields: audit.fields };
      }

      if (dryRun) {
        if (!isHeadless) {
          await page.waitForTimeout(4000);
        }
        await browser.close();
        return { success: true, dryRun: true, message: "Dry-run: Ashby form filled and audited successfully", fields: audit.fields };
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
      let graphQlSubmitted = false;
      page.on("response", async (response) => {
        try {
          if (response.url().includes("ApiSubmitSingleApplicationFormAction")) {
            const data = await response.json();
            if (data.errors && data.errors.length > 0) {
              graphQlError = data.errors.map(e => e.message).join("; ");
            } else if (response.ok()) {
              graphQlSubmitted = true;
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
          graphQlSubmitted ||
          confirmationUrl.includes("confirmation") ||
          confirmationUrl.includes("applied") ||
          content.includes("thank you for applying") ||
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
      return { success: true, confirmationUrl, fields: audit.fields };
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

module.exports = { runAutoApply, bestOptionIndex };
