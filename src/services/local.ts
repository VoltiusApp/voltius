import { invoke } from "@/lib/invoke";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onTerminalClosed, onTerminalOutput } from "@/services/terminalOutput";
import { isEnforcedLock, lockedValue, policyRange } from "@/stores/policyStore";
import type { ShellOption } from "@/components/layout/newSessionItems";

const SHELL_KEY = "appSettings.terminal.preferredShell";

let shellsMemo: Promise<ShellOption[]> | undefined;

export function listLocalShells(): Promise<ShellOption[]> {
  shellsMemo ??= invoke<ShellOption[]>("local_list_shells").catch((e) => {
    shellsMemo = undefined;
    throw e;
  });
  return shellsMemo;
}

export function shellPolicyEntries(): string[] | undefined {
  const lock = lockedValue(SHELL_KEY);
  if (isEnforcedLock(SHELL_KEY) && lock.locked) return typeof lock.value === "string" ? [lock.value] : undefined;
  return policyRange(SHELL_KEY)?.allowed?.filter((e): e is string => typeof e === "string");
}

const matchesEntry = (shell: ShellOption, entry: string) =>
  shell.path === entry || shell.name.toLowerCase() === entry.toLowerCase();

export function allowedShells(shells: ShellOption[], entries = shellPolicyEntries()): ShellOption[] {
  return entries ? shells.filter((s) => entries.some((e) => matchesEntry(s, e))) : shells;
}

export async function policyShell(requested: string | undefined): Promise<string | undefined> {
  const entries = shellPolicyEntries();
  if (!entries) return requested;
  const allowed = allowedShells(await listLocalShells(), entries);
  if (requested !== undefined && allowedShells(allowed, [requested]).length) return requested;
  return allowed[0]?.path;
}

export async function localConnect(sessionId: string, cols: number, rows: number, shell?: string, cwd?: string, shellIntegration?: boolean): Promise<void> {
  return invoke("local_connect", {
    sessionId, cols, rows,
    shell: (await policyShell(shell)) ?? null,
    cwd: cwd ?? null,
    shellIntegration: shellIntegration ?? null,
  });
}

/** Acknowledge that the terminal has subscribed to this session's output.
 *  Releases the backend's startup gate, which replays what the shell wrote
 *  before that. */
export async function localReady(sessionId: string): Promise<void> {
  return invoke("local_ready", { sessionId });
}

export async function localDisconnect(sessionId: string): Promise<void> {
  return invoke("local_disconnect", { sessionId });
}

export async function localSendInput(sessionId: string, data: Uint8Array): Promise<void> {
  return invoke("local_send_input", { sessionId, data: Array.from(data) });
}

export async function localResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("local_resize", { sessionId, cols, rows });
}

export async function onLocalOutput(
  sessionId: string,
  callback: (data: Uint8Array) => void,
): Promise<UnlistenFn> {
  return onTerminalOutput(sessionId, true, callback);
}

export async function onLocalClosed(
  sessionId: string,
  callback: (cleanExit: boolean) => void,
): Promise<UnlistenFn> {
  return onTerminalClosed(sessionId, true, callback);
}
