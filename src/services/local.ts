import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export async function localConnect(sessionId: string, cols: number, rows: number, shell?: string, cwd?: string): Promise<void> {
  return invoke("local_connect", { sessionId, cols, rows, shell: shell ?? null, cwd: cwd ?? null });
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
  return listen<number[]>(`local-output-${sessionId}`, (event) => {
    callback(new Uint8Array(event.payload));
  });
}

export async function onLocalClosed(
  sessionId: string,
  callback: () => void,
): Promise<UnlistenFn> {
  return listen(`local-closed-${sessionId}`, () => callback());
}
