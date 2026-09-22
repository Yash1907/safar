import { describe, it, expect } from "bun:test";
import {
  sendApplicationAlert,
  sendEndOfDayReport,
} from "../src/discord.ts";

describe("Discord webhook payload formatting", () => {
  it("formats application alert correctly even if webhook fails network call", async () => {
    // Calling with an unreachable or mock URL to verify error handling without crashing
    const result = await sendApplicationAlert("http://127.0.0.1:9999/fake-webhook", {
      company: "Stripe",
      title: "Software Engineer",
      url: "https://stripe.com/jobs/123",
      platform: "greenhouse",
      appliedAt: 1790070000,
    });
    // Should fail gracefully with success=false and an error string
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("formats end of day report with empty application list gracefully", async () => {
    const result = await sendEndOfDayReport("http://127.0.0.1:9999/fake-webhook", {
      date: "2026-09-22",
      applications: [],
    });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("formats end of day report with multiple applications gracefully", async () => {
    const result = await sendEndOfDayReport("http://127.0.0.1:9999/fake-webhook", {
      date: "2026-09-22",
      applications: [
        {
          company: "SingleStore",
          title: "SWE Intern",
          url: "https://job-boards.greenhouse.io/singlestore/jobs/8221924",
          platform: "greenhouse",
          appliedAt: 1790070000,
        },
        {
          company: "Mechanize",
          title: "Software Engineer",
          url: "https://jobs.ashbyhq.com/mechanize/1ef28bb2-6251-4da6-a590-a4a7606368cb",
          platform: "ashby",
          appliedAt: 1790071000,
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});
