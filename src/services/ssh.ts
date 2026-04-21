import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface JumpHostConnect {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export async function sshConnect(params: {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  connectionId?: string;
  jumpHosts?: JumpHostConnect[];
  envVars?: [string, string][];
  agentForwarding?: boolean;
  preCommand?: string;
}): Promise<void> {
  return invoke("ssh_connect", {
    sessionId: params.sessionId,
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password ?? null,
    privateKey: params.privateKey ?? null,
    connectionId: params.connectionId ?? null,
    jumpHosts: params.jumpHosts && params.jumpHosts.length > 0 ? params.jumpHosts : null,
    envVars: params.envVars && params.envVars.length > 0 ? params.envVars : null,
    agentForwarding: params.agentForwarding ?? false,
    preCommand: params.preCommand ?? null,
  });
}

export async function sshDisconnect(sessionId: string, postCommand?: string): Promise<void> {
  return invoke("ssh_disconnect", { sessionId, postCommand: postCommand ?? null });
}

export async function sshSendInput(sessionId: string, data: Uint8Array): Promise<void> {
  return invoke("ssh_send_input", { sessionId, data: Array.from(data) });
}

export async function sshResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("ssh_resize", { sessionId, cols, rows });
}

export async function sshDetectDistro(sessionId: string): Promise<string> {
  return invoke("ssh_detect_distro", { sessionId });
}

export async function sshExecCommand(params: {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  command: string;
}): Promise<string> {
  return invoke("ssh_exec_command", {
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password ?? null,
    privateKey: params.privateKey ?? null,
    command: params.command,
  });
}

export async function onSshOutput(
  sessionId: string,
  callback: (data: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<number[]>(`ssh-output-${sessionId}`, (event) => {
    callback(new Uint8Array(event.payload));
  });
}

export async function onSshClosed(
  sessionId: string,
  callback: () => void,
): Promise<UnlistenFn> {
  return listen(`ssh-closed-${sessionId}`, () => {
    callback();
  });
}
