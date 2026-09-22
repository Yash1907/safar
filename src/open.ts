/** Builds the platform-specific command to open a URL in the default browser. */
export function getOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "darwin") {
    return ["open", url];
  }
  if (platform === "win32") {
    // In cmd.exe /c start, special characters like &, %, ^, <, >, | must be escaped with ^
    // so cmd doesn't interpret them as command delimiters or redirection.
    return ["cmd", "/c", "start", "", url.replace(/[%^&<>|]/g, "^$&")];
  }
  return ["xdg-open", url];
}

/** Opens a URL in the default browser. §4: `open` on macOS. */
export function openUrl(url: string): void {
  Bun.spawn(getOpenCommand(url), { stdout: "ignore", stderr: "ignore" });
}

