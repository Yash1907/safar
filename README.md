# safar

**safar** is a high-performance terminal job aggregator, application tracker, and headless auto-applier built with TypeScript, React/Ink, and Bun.

It pulls listings from curated GitHub job boards into a local SQLite database, classifies application forms, auto-applies to default Greenhouse and Ashby listings in the background, tracks application lifecycles, and sends real-time and end-of-day reports to Discord via webhooks.

---

## ✨ Features

- **TUI Job Board & CRM**: Interactive terminal UI featuring three top-level tabs:
  - **Browse**: Virtualized list of all synced job listings with powerful fuzzy and token filtering.
  - **Skipped**: Dedicated review tab for jobs not auto-applied (non-Greenhouse/Ashby or jobs with custom essay questions), showing the exact reason each job was skipped so you can apply manually.
  - **Tracker**: Kanban-style CRM grouped by application status (`applied`, `oa`, `interviewing`, `offer`, `rejected`, `withdrawn`), tracking stale days and audit timeline.
- **Headless Auto-Applier**:
  - Automatically applies to **Greenhouse** and **Ashby** jobs posted within the past 3 days.
  - **"Default Jobs" Classifier**: Strict classification ensuring auto-apply *only* touches jobs asking for standard information (Name, Email, Phone, Resume, Education/School, Experience, Links, standard Work Auth, standard EEO). Any job requiring custom essay questions (e.g. *"Why this job?"*, *"What is the hardest challenge you've faced?"*, *"Tell us about a project"*) is safely skipped and routed to the **Skipped** tab.
  - **Repost & Duplicate Detection**: Prevents applying twice to the same job and detects reposted listings by matching normalized company names and role titles across your application history.
  - **100% Headless**: Runs Playwright Chromium invisibly in the background without stealing window focus or interrupting normal PC work.
- **Discord Webhook Notifications**:
  - **Real-Time Alerts**: Rich Discord embed sent immediately upon each successful auto-application.
  - **End-of-Day Check**: Daily summary sent at the end of the day listing all companies and titles applied to that day, plus the total application count.
- **Google Sheets Sync**: Optional bidirectional sync with Google Sheets.

---

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh/) (>= 1.1)
- [Node.js](https://nodejs.org/) (for headless Playwright automation)

### Installation
```bash
# Clone the repository
git clone https://github.com/Yash1907/safar.git
cd safar

# Install dependencies and Chromium
bun install
bunx playwright install chromium
```

### Launch Interactive TUI
```bash
bun dev
```

---

## ⚙️ Configuration

Create or edit your configuration at `~/.config/safar/config.json` (or `%APPDATA%\safar\config.json` on Windows):

```json
{
  "sources": {
    "simplify": [
      {
        "id": "simplify-newgrad",
        "displayName": "SimplifyJobs New Grad",
        "owner": "SimplifyJobs",
        "repo": "New-Grad-Positions",
        "branch": "dev",
        "enabled": true
      },
      {
        "id": "simplify-summer2026",
        "displayName": "SimplifyJobs Summer Internships 2026",
        "owner": "SimplifyJobs",
        "repo": "Summer2026-Internships",
        "branch": "dev",
        "enabled": false
      }
    ],
    "jobright": [
      {
        "id": "jobright-swe-2026",
        "displayName": "jobright SWE New Grad 2026",
        "owner": "jobright-ai",
        "repo": "2026-Software-Engineer-New-Grad",
        "branch": "master",
        "enabled": true
      }
    ],
    "zapply": [
      {
        "id": "zapply-newgrad-2027",
        "displayName": "Zapply New Grad 2027",
        "owner": "zapplyjobs",
        "repo": "New-Grad-Jobs-2027",
        "branch": "main",
        "enabled": true
      }
    ]
  },
  "discord": {
    "webhookUrl": "https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN",
    "eodSummaryTime": "18:00"
  },
  "profile": {
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "janedoe@example.com",
    "phone": "+1-555-123-4567",
    "resumePath": "C:\\Users\\Jane\\Documents\\resume.pdf",
    "linkedinUrl": "https://linkedin.com/in/janedoe",
    "githubUrl": "https://github.com/janedoe",
    "githubOnlyIfRequired": true,
    "portfolioUrl": "https://janedoe.dev",
    "willingToRelocate": true,
    "address": {
      "city": "San Francisco",
      "state": "CA",
      "country": "United States",
      "postalCode": "94105"
    },
    "education": {
      "school": "University of California, Berkeley",
      "degree": "Bachelor of Science",
      "discipline": "Computer Science",
      "graduationYear": 2026,
      "graduationMonth": 5,
      "gpa": "3.85"
    },
    "workAuthorization": {
      "authorizedInUS": true,
      "requiresSponsorship": false,
      "willingToRelocate": true
    },
    "demographics": {
      "gender": "Decline to Self-Identify",
      "race": "Decline to Self-Identify",
      "veteran": "Decline to Self-Identify",
      "disability": "Decline to Self-Identify"
    },
    "intern": {
      "resumePath": "C:\\Users\\Jane\\Documents\\resume_intern.pdf",
      "willingToRelocate": true,
      "education": {
        "graduationYear": 2027,
        "graduationMonth": "August"
      }
    },
    "fulltime": {
      "resumePath": "C:\\Users\\Jane\\Documents\\resume_fulltime.pdf",
      "willingToRelocate": true,
      "education": {
        "graduationYear": 2026,
        "graduationMonth": "May"
      }
    }
  },
  "autoApply": {
    "enabled": true,
    "lookbackDays": 3,
    "dryRun": false
  }
}
```

#### 🎓 Intern vs. Full-Time Role Profiles & Preferences
Safar automatically categorizes positions into **Internship** (`intern`) vs **Full-Time / New Grad** (`fulltime` / `ft`) using title keywords and source repositories.

You can customize your application per role type by adding `"intern"` and `"fulltime"` (or `"ft"`) overrides directly inside `"profile"`.
- **Graduation Dates**: Specify `graduationYear` (e.g. `2027`) and `graduationMonth` (as number `5` or string `"May"`, `"August"`, etc.) independently for intern vs full-time.
- **Relocation & Work Auth**: Set `willingToRelocate: true/false` globally or override per role. Safar handles standard relocation, onsite/hybrid commute, and 18+ legal age questions automatically.
- **Conditional GitHub**: Set `"githubOnlyIfRequired": true` to provide your GitHub link only when the application explicitly marks it as mandatory.
- **Demographics**: Standard voluntary self-identification fields (gender, race/ethnicity, veteran status, disability) default to `"Decline to Self-Identify"`. Safar fuzzy-matches whatever preference you configure.

---

## 🤖 Headless Auto-Applier & CLI Usage

### Auto-Apply
Scan all active jobs from the past 3 days, classify application forms, and auto-apply to eligible default Greenhouse and Ashby jobs:
```bash
# Test form filling without actually submitting
bun run src/index.tsx --auto-apply --dry-run

# Run live auto-apply
bun run src/index.tsx --auto-apply

# Apply only to internship roles using your intern profile
bun run src/index.tsx --auto-apply --role intern

# Apply only to full-time roles using your full-time profile
bun run src/index.tsx --auto-apply --role ft

# Custom lookback window (e.g. past 5 days) and application limit
bun run src/index.tsx --auto-apply --days 5 --limit 10
```

### End-of-Day Discord Check
Send today's application report to Discord via webhook:
```bash
bun run src/index.tsx --eod-report
```

### Automated Background Scheduler
Run a background daemon that periodically syncs sources, auto-applies to new listings, and sends the EOD summary to Discord at your configured `eodSummaryTime` (default: 18:00):
```bash
bun run src/index.tsx --scheduler
```

### Command Line Options Reference
```
Usage:
  safar [options]

Options:
  --sync           Fetch latest jobs from all configured sources
  --auto-apply     Auto-apply to default Greenhouse & Ashby jobs (past 3 days)
  --dry-run        Test form filling headlessly without submitting
  --days <N>       Lookback days for auto-apply (default: 3)
  --limit <N>      Maximum jobs to auto-apply to
  --role <type>    Filter auto-apply by role: intern, ft, or all (default: all)
  --eod-report     Send end-of-day summary report to Discord webhook
  --scheduler      Run automated background scheduler for auto-apply & daily check
  --export <path>  Export all jobs to .csv or .json
  --sheets-sync    Push tracked jobs to Google Sheets
  --sheets-pull    Pull tracked jobs from Google Sheets
  --db <path>      Custom SQLite database path (default: ~/.local/share/safar/safar.db)
  --config <path>  Custom config path (default: ~/.config/safar/config.json)
  --help, -h       Show help message
```

---

## 🖥️ Terminal UI (TUI) Keymap

| Key | Description |
|---|---|
| `Tab` | Switch tabs: **Browse** ➔ **Skipped** ➔ **Tracker** |
| `j` / `k` or `↓` / `↑` | Move selection down / up |
| `Ctrl+d` / `Ctrl+u` | Half-page down / up |
| `g` / `G` | Jump to top / bottom |
| `/` | Filter search (fuzzy match or tokens like `loc:`, `cat:`, `wm:`) |
| `Enter` | Open detailed job sub-view (notes, status history timeline) |
| `o` | Open job application link in default web browser |
| `A` | **Auto-apply** headlessly to selected job (Greenhouse & Ashby default jobs) |
| `a` | Mark selected job as **applied** manually (removes from Skipped, adds to Tracker) |
| `s` | Mark selected job as **saved** |
| `u` | Undo last status change |
| `d` | Delete application tracking |
| `r` | Trigger manual source sync |
| `S` | Push tracked jobs to Google Sheets |
| `p` | Pull tracked jobs from Google Sheets |
| `q` | Quit Safar |

---

## 🔍 How "Default Jobs" are Classified

A job is classified as a **default job** if and only if all required questions match standard candidate fields:
- **Personal Info**: Name, Preferred Name, Email, Phone, Address/Location
- **Documents**: Resume / CV file upload, Optional Cover Letter
- **Education**: School / University, Degree, Discipline / Major, Graduation Date, GPA
- **Experience**: Employer, Title, Dates
- **Links**: LinkedIn, GitHub, Portfolio / Personal Website
- **Compliance & Work Auth**: Legal authorization to work, visa sponsorship, age requirement, ITAR
- **EEO Demographics**: Voluntary self-identification questions (Gender, Race, Veteran, Disability)

**Disqualifying Custom Questions:**
Any question asking for open-ended written answers or essays (such as *"Why this job?"*, *"What is the hardest challenge you've faced?"*, *"Tell us about a project you built"*, required custom writing samples, or non-standard textareas) causes the job to be flagged as non-default and routed directly to the **Skipped** tab with the specific reason recorded.

---

## 🧪 Testing

Run the test suite with Bun:
```bash
bun test
```
All unit tests for the classifier, deduplication engine, Discord webhook client, database migrations, and repository queries run in memory with 100% test pass rate.
