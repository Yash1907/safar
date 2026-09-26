import { describe, expect, test } from "bun:test";

const { bestOptionIndex } = require("../src/applier/playwright-runner.cjs");

describe("application combobox matching", () => {
  test("selects Lexington, Massachusetts instead of Lexington, Maine", () => {
    const options = [
      "Lexington, Massachusetts, United States",
      "Lexington, Maine, United States",
      "North Lexington, Massachusetts, United States",
    ];
    expect(
      bestOptionIndex(options, ["Lexington, Massachusetts, United States"]),
    ).toBe(0);
  });

  test("matches the configured Rutgers campus from shortened search results", () => {
    const options = [
      "Rutgers, the State University of New Jersey - Camden",
      "Rutgers, the State University of New Jersey - Newark",
      "Rutgers, the State University of New Jersey - New Brunswick",
    ];
    expect(bestOptionIndex(options, ["Rutgers University - New Brunswick"])).toBe(2);
  });

  test("does not treat a no-options message as a selectable answer", () => {
    expect(bestOptionIndex(["No options"], ["Bachelor of Science"])).toBe(-1);
  });
});
