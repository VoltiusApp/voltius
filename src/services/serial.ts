import { invoke } from "@/lib/invoke";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onTerminalClosed, onTerminalOutput } from "@/services/terminalOutput";
import type { SerialConnectParams, SerialLine, SerialLines } from "@/types";

export async function serialConnect(params: SerialConnectParams): Promise<SerialLines> {
  return invoke("serial_connect", {
    sessionId: params.sessionId,
    port: params.port,
    baud: params.baud,
    dataBits: params.dataBits ?? null,
    parity: params.parity ?? null,
    stopBits: params.stopBits ?? null,
    flowControl: params.flowControl ?? null,
  });
}

export async function serialWrite(sessionId: string, data: Uint8Array): Promise<void> {
  return invoke("serial_write", { sessionId, data: Array.from(data) });
}

export async function serialSetLine(sessionId: string, line: SerialLine, level: boolean): Promise<SerialLines> {
  return invoke("serial_set_line", { sessionId, line, level });
}

export async function serialSendBreak(sessionId: string): Promise<void> {
  return invoke("serial_send_break", { sessionId });
}

export async function serialDisconnect(sessionId: string): Promise<void> {
  return invoke("serial_disconnect", { sessionId });
}

export async function serialListPorts(): Promise<{ name: string; path: string }[]> {
  return invoke("serial_list_ports");
}

export async function onSerialOutput(
  sessionId: string,
  callback: (data: Uint8Array) => void,
): Promise<UnlistenFn> {
  return onTerminalOutput(sessionId, false, callback);
}

export async function onSerialClosed(
  sessionId: string,
  callback: () => void,
): Promise<UnlistenFn> {
  return onTerminalClosed(sessionId, false, () => callback());
}
