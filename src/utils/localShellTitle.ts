const SHELL_LABELS: Record<string, string> = {
  "wsl": "WSL",
  "pwsh": "Pwsh",
  "powershell": "PowerShell",
  "cmd": "Cmd",
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function titleCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` : value;
}

export function formatLocalShellTitle(shellPath?: string | null): string {
  if (!shellPath) return "Local Shell";

  const name = basename(shellPath).replace(/\.exe$/i, "").trim();
  if (!name) return "Local Shell";

  return `Local: ${SHELL_LABELS[name.toLowerCase()] ?? titleCase(name)}`;
}
