import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface JumpHostConnect {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export async function sshConnect(params: {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  connectionId?: string;
  jumpHosts?: JumpHostConnect[];
  envVars?: [string, string][];
  agentForwarding?: boolean;
  legacyAlgorithms?: boolean;
  preCommand?: string;
  autoForward?: boolean;
  shellIntegration?: boolean;
  keepaliveIntervalSecs: number;
  keepaliveMax: number;
  persist?: boolean;
  restore?: boolean;
  /** Re-attach/join an existing multiplexer session; never creates one.
   * Rejects with SESSION_ENDED when the session is gone on the host. */
  attachOnly?: boolean;
  cols?: number;
  rows?: number;
  /** Directory the shell starts in. First connect only — a reconnect must not
   * move a session the user has since navigated elsewhere. */
  initialCwd?: string;
}): Promise<void> {
  return invoke("ssh_connect", {
    sessionId: params.sessionId,
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password ?? null,
    privateKey: params.privateKey ?? null,
    passphrase: params.passphrase ?? null,
    connectionId: params.connectionId ?? null,
    jumpHosts: params.jumpHosts && params.jumpHosts.length > 0 ? params.jumpHosts : null,
    envVars: params.envVars && params.envVars.length > 0 ? params.envVars : null,
    agentForwarding: params.agentForwarding ?? false,
    legacyAlgorithms: params.legacyAlgorithms ?? false,
    preCommand: params.preCommand ?? null,
    autoForward: params.autoForward ?? true,
    shellIntegration: params.shellIntegration ?? null,
    keepaliveIntervalSecs: params.keepaliveIntervalSecs,
    keepaliveMax: params.keepaliveMax,
    persist: params.persist ?? null,
    restore: params.restore ?? null,
    attachOnly: params.attachOnly ?? null,
    cols: params.cols ?? null,
    rows: params.rows ?? null,
    initialCwd: params.initialCwd ?? null,
  });
}

/** Resolves to whether the persistent multiplexer session was confirmed
 * killed on the host (shared sessions: kill happens only when no other
 * client/device uses it; `attached` = our own channel is still attached). */
export async function sshDisconnect(
  sessionId: string,
  postCommand?: string,
  killPersistent?: boolean,
  attached?: boolean,
  reconnecting?: boolean,
): Promise<boolean> {
  return invoke("ssh_disconnect", {
    sessionId,
    postCommand: postCommand ?? null,
    killPersistent: killPersistent ?? null,
    attached: attached ?? null,
    reconnecting: reconnecting ?? null,
  });
}

/** Drop the SSH connection as the first half of a reconnect under the same
 * session id. Keeps the session's port forwards up: they are re-armed by the
 * matching `sshConnect`, so ad-hoc tunnels survive the round trip. */
export async function sshDisconnectForReconnect(sessionId: string): Promise<void> {
  await sshDisconnect(sessionId, undefined, undefined, undefined, true).catch(() => {});
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

export interface SystemInfo {
  pretty_name: string;
  version_id: string;
  kernel: string;
  arch: string;
}

export async function sshGetSystemInfo(sessionId: string): Promise<SystemInfo> {
  return invoke("ssh_get_system_info", { sessionId });
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  /** null when the channel closed without ever reporting an exit status — treat as a failure, not as 0. */
  exit_code: number | null;
}

export async function sshExecCommand(params: {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  command: string;
}): Promise<SshExecResult> {
  return invoke("ssh_exec_command", {
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password ?? null,
    privateKey: params.privateKey ?? null,
    passphrase: params.passphrase ?? null,
    command: params.command,
  });
}

export async function sshKillPersistent(params: {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  sessionId: string;
}): Promise<boolean> {
  return invoke("ssh_kill_persistent", {
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password ?? null,
    privateKey: params.privateKey ?? null,
    passphrase: params.passphrase ?? null,
    sessionId: params.sessionId,
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

/** `remoteExit` is true when the far side sent an exit-status/exit-signal
 * before closing — the remote command ended on its own, it was not a drop. */
export async function onSshClosed(
  sessionId: string,
  callback: (remoteExit: boolean) => void,
): Promise<UnlistenFn> {
  return listen<boolean>(`ssh-closed-${sessionId}`, (event) => {
    callback(event.payload === true);
  });
}

// Backend-polled cwd for persistent sessions, where the tmux/screen multiplexer
// swallows the shell's OSC 7 so the terminal's own OSC 7 handler never sees it.
export async function onSshCwd(
  sessionId: string,
  callback: (cwd: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(`ssh-cwd-${sessionId}`, (event) => {
    callback(event.payload);
  });
}
