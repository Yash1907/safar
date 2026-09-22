import { describe, expect, test } from "bun:test";
import { getOpenCommand } from "../src/open.ts";

describe("getOpenCommand", () => {
  test("uses 'open' on macOS (darwin)", () => {
    expect(getOpenCommand("https://example.com", "darwin")).toEqual(["open", "https://example.com"]);
  });

  test("uses 'xdg-open' on Linux", () => {
    expect(getOpenCommand("https://example.com", "linux")).toEqual(["xdg-open", "https://example.com"]);
  });

  test("uses cmd /c start on win32", () => {
    const cmd = getOpenCommand("https://example.com", "win32");
    expect(cmd).toEqual(["cmd", "/c", "start", "", "https://example.com"]);
  });

  test("escapes ampersands and special shell characters on win32", () => {
    const url = "https://jobright.ai/jobs/info/123?utm_source=foo&utm_medium=bar%20test";
    const cmd = getOpenCommand(url, "win32");
    expect(cmd[0]).toBe("cmd");
    expect(cmd[1]).toBe("/c");
    expect(cmd[2]).toBe("start");
    expect(cmd[3]).toBe("");
    expect(cmd[4]).toContain("^&");
    expect(cmd[4]).toContain("^%");
    expect(cmd[4]).toBe("https://jobright.ai/jobs/info/123?utm_source=foo^&utm_medium=bar^%20test");
  });
});
