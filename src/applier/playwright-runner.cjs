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

async function selectOption(page, selectSelectors, preferredValues) {
  for (const sel of selectSelectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        const options = await el.$$eval("option", opts => opts.map(o => ({ value: o.value, text: o.text.trim() })));
        for (const pref of preferredValues) {
          const match = options.find(o => o.text.toLowerCase().includes(pref.toLowerCase()) || o.value.toLowerCase().includes(pref.toLowerCase()));
          if (match) {
            await el.selectOption(match.value);
            return true;
          }
        }
      }
    } catch {}
  }
  return false;
}

async function runAutoApply({ url, platform, profile, dryRun }) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-startup-window", "--disable-gpu", "--no-sandbox"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Ensure resume file exists if specified
    const resumeExists = profile.resumePath && fs.existsSync(profile.resumePath);

    if (platform === "greenhouse") {
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
          const name = (await input.getAttribute("name")) || "";
          const id = (await input.getAttribute("id")) || "";
          if (name.includes("resume") || id.includes("resume") || fileInputs.length === 1) {
            await input.setInputFiles(profile.resumePath);
            break;
          }
        }
      }

      // 5. Links: LinkedIn, GitHub, Website
      await fillField(page, [
        'input[name*="linkedin" i]',
        'input[id*="linkedin" i]',
      ], profile.linkedinUrl);

      await fillField(page, [
        'input[name*="github" i]',
        'input[id*="github" i]',
      ], profile.githubUrl);

      await fillField(page, [
        'input[name*="website" i]',
        'input[id*="website" i]',
        'input[name*="portfolio" i]',
      ], profile.portfolioUrl);

      // 6. School / Education
      if (profile.education?.school) {
        await fillField(page, ['input[name*="school" i]', 'input[id*="school" i]'], profile.education.school);
      }
      if (profile.education?.degree) {
        await fillField(page, ['input[name*="degree" i]', 'input[id*="degree" i]'], profile.education.degree);
      }
      if (profile.education?.discipline) {
        await fillField(page, ['input[name*="discipline" i]', 'input[id*="discipline" i]'], profile.education.discipline);
      }

      // 7. Work Authorization standard dropdowns
      await selectOption(page, ['select[name*="authorized" i]', 'select[id*="authorized" i]'], ["Yes", "true"]);
      await selectOption(page, ['select[name*="sponsorship" i]', 'select[id*="sponsorship" i]'], ["No", "false"]);

      // 8. EEO Demographics standard defaults
      await selectOption(page, ['select[name*="gender" i]', 'select[id*="gender" i]'], [profile.demographics?.gender || "Decline", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="race" i]', 'select[id*="race" i]'], [profile.demographics?.race || "Decline", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="veteran" i]', 'select[id*="veteran" i]'], [profile.demographics?.veteran || "Decline", "not a protected", "Decline to Self-Identify"]);
      await selectOption(page, ['select[name*="disability" i]', 'select[id*="disability" i]'], [profile.demographics?.disability || "Decline", "No, I do not", "Decline to Self-Identify"]);

      // 9. Submit or Dry-run
      if (dryRun) {
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
      await page.waitForTimeout(5000);

      // Check success
      const currentUrl = page.url();
      const content = await page.content();
      const success = currentUrl.includes("confirmation") ||
                      content.toLowerCase().includes("thank you for applying") ||
                      content.toLowerCase().includes("application submitted");

      await browser.close();
      return { success: true, confirmationUrl: currentUrl };

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
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(profile.resumePath);
          await page.waitForTimeout(1000);
        }
      }

      // 4. Links
      await fillField(page, ['input[name*="linkedin" i]'], profile.linkedinUrl);
      await fillField(page, ['input[name*="github" i]'], profile.githubUrl);
      await fillField(page, ['input[name*="portfolio" i]', 'input[name*="website" i]'], profile.portfolioUrl);

      // 5. Work auth boolean radios/buttons in Ashby
      // Ashby often uses buttons/radios for booleans like "Authorized to work in US"
      try {
        const yesButtons = await page.$$('button:has-text("Yes"), label:has-text("Yes")');
        for (const btn of yesButtons) {
          const parentText = await btn.evaluate(el => el.closest('div')?.textContent || '');
          if (parentText.toLowerCase().includes('authorized to work') || parentText.toLowerCase().includes('onsite')) {
            await btn.click();
          }
        }
        const noButtons = await page.$$('button:has-text("No"), label:has-text("No")');
        for (const btn of noButtons) {
          const parentText = await btn.evaluate(el => el.closest('div')?.textContent || '');
          if (parentText.toLowerCase().includes('sponsorship')) {
            await btn.click();
          }
        }
      } catch {}

      if (dryRun) {
        await browser.close();
        return { success: true, dryRun: true, message: "Dry-run: Ashby form filled successfully" };
      }

      const submitBtn = await page.$(
        'button[type="submit"], button:has-text("Submit Application"), button:has-text("Apply")'
      );
      if (!submitBtn) {
        await browser.close();
        return { success: false, error: "Submit button not found on Ashby application form" };
      }

      await submitBtn.click();
      await page.waitForTimeout(5000);

      const content = await page.content();
      const currentUrl = page.url();
      const success = currentUrl.includes("confirmation") ||
                      content.toLowerCase().includes("thank you") ||
                      content.toLowerCase().includes("application submitted");

      await browser.close();
      return { success: true, confirmationUrl: currentUrl };
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
