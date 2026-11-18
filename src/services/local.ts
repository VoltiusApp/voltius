import { invoke } from "@/lib/invoke";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onTerminalClosed, onTerminalOutput } from "@/services/terminalOutput";
import { isEnforcedLock, lockedValue, policyRange } from "@/stores/policyStore";
import { preferredShellSetting } from "@/stores/terminalSettingsStore";
import type { ShellOption } from "@/components/layout/newSessionItems";

const SHELL_KEY = preferredShellSetting.key;

let shellsMemo: Promise<ShellOption[]> | undefined;
let shellsPending = false;
let shellsDetected: ShellOption[] | undefined;

export const detectedShells = () => shellsDetected;

export function listLocalShells(refresh = false): Promise<ShellOption[]> {
  if (!shellsMemo || (refresh && !shellsPending)) {
    shellsPending = true;
    const fetched = invoke<ShellOption[]>("local_list_shells")
      .then((shells) => (shellsDetected = shells))
      .catch((e) => {
        if (shellsMemo === fetched) shellsMemo = undefined;
        throw e;
      })
      .finally(() => {
        shellsPending = false;
      });
    shellsMemo = fetched;
  }
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

const fileNames = (value: string) => {
  const file = value.split(/[\\/]/).pop() ?? value;
  return [file, file.replace(/(.)\.[^.]*$/, "$1")];
};

// Mirrors `shell_allows` in src-tauri/src/policy/mod.rs; src-tauri/src/policy/fixtures/shell.json keeps them in step.
function shellAllows(shells: ShellOption[], entry: string, value: string): boolean {
  const detected = shells.find((s) => matchesEntry(s, value));
  if (detected) return matchesEntry(detected, entry);
  return entry === value || fileNames(value).some((n) => n.toLowerCase() === entry.toLowerCase());
}

export function pickShell(shells: ShellOption[], requested: string | null | undefined, entries = shellPolicyEntries()): ShellOption | undefined {
  const allowed = allowedShells(shells, entries);
  if (!requested) return allowed[0];
  const among = (e: string) => allowed.find((s) => matchesEntry(s, e));
  const entry = entries?.find((e) => shellAllows(shells, e, requested));
  return among(requested) ?? (entry ? among(entry) : undefined) ?? allowed[0];
}

const spawnShell = (shells: ShellOption[], requested: string | undefined, entries: string[] | undefined) =>
  entries ? pickShell(shells, requested, entries)?.path : requested;

export async function policyShell(requested: string | undefined): Promise<string | undefined> {
  const entries = shellPolicyEntries();
  return spawnShell(entries ? await listLocalShells() : [], requested, entries);
}

export function effectiveShell(requested: string | null): string | null {
  const entries = shellPolicyEntries();
  return entries && shellsDetected ? spawnShell(shellsDetected, requested ?? undefined, entries) ?? null : requested;
}

export async function localConnect(sessionId: string, cols: number, rows: number, shell?: string, cwd?: string, shellIntegration?: boolean): Promise<string | undefined> {
  const spawned = await policyShell(shell);
  await invoke("local_connect", {
    sessionId, cols, rows,
    shell: spawned ?? null,
    cwd: cwd ?? null,
    shellIntegration: shellIntegration ?? null,
  });
  return spawned;
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
