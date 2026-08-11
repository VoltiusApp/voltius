/** Windows paths use backslashes or a drive-letter prefix; both are illegal in POSIX paths. */
function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\");
}

/**
 * Double quotes are safe on Windows: `"` cannot appear in a Windows path.
 * On POSIX shells, single quotes are the only quoting that is safe against
 * every other special character; an embedded `'` is closed, escaped, reopened.
 */
export function quotePath(path: string): string {
  if (isWindowsPath(path)) return `"${path}"`;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function buildMcpRegisterCommand(exePath: string): string {
  return `claude mcp add voltius -- ${quotePath(exePath)} mcp`;
}

/**
 * add-mcp v2's single-command onboarding: `--args` is a separate repeatable
 * flag so the exe path stays one argv token even with spaces. `-g` targets
 * the global scope (add-mcp defaults to per-project). `@2` pins the major
 * version tested against this behaviour.
 *
 * The two `-y` flags are not the same and only one is passed. `npx -y` skips
 * npx's own install-consent prompt, which guards nothing here — the package is
 * already named in the command. add-mcp's own `-y` skips the confirmation
 * showing which agents it will touch, and is deliberately omitted: that step
 * writes config files on a machine where Voltius holds SSH credentials.
 */
export function buildAddMcpCommand(exePath: string): string {
  return `npx -y add-mcp@2 ${quotePath(exePath)} --args mcp -n voltius -g`;
}
