import { invoke } from "@/lib/invoke";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onTerminalClosed, onTerminalOutput } from "@/services/terminalOutput";

export async function localConnect(sessionId: string, cols: number, rows: number, shell?: string, cwd?: string, shellIntegration?: boolean): Promise<void> {
  return invoke("local_connect", {
    sessionId, cols, rows,
    shell: shell ?? null,
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
