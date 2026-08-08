/** Windows paths use backslashes or a drive-letter prefix; both are illegal in POSIX paths. */
function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\");
}

/**
 * Double quotes are safe on Windows: `"` cannot appear in a Windows path.
 * On POSIX shells, single quotes are the only quoting that is safe against
 * every other special character; an embedded `'` is closed, escaped, reopened.
 */
function quotePath(path: string): string {
  if (isWindowsPath(path)) return `"${path}"`;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function buildMcpRegisterCommand(exePath: string): string {
  return `claude mcp add voltius -- ${quotePath(exePath)} mcp`;
}
