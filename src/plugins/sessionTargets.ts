import type { PluginAPI, PluginSession } from "@/plugins/api";

/** Session types that accept shell command text. Anything else — a serial
 *  session above all — would receive the command as raw bytes on a wire to a
 *  physical device. */
const SHELL_SESSION_TYPES = new Set(["ssh", "local"]);

export function requireOpenSession(api: PluginAPI, sessionId: string): PluginSession {
  const session = api.sessions.list().find((s) => s.id === sessionId);
  if (!session) throw new Error(`no open session with id "${sessionId}"`);
  return session;
}

export function requireShellSession(api: PluginAPI, sessionId: string): PluginSession {
  const session = requireOpenSession(api, sessionId);
  if (!SHELL_SESSION_TYPES.has(session.type)) {
    throw new Error(
      `session "${sessionId}" is a "${session.type}" session; only ssh and local sessions run commands`,
    );
  }
  return session;
}

export function requireSshSession(api: PluginAPI, sessionId: string): string {
  const session = requireOpenSession(api, sessionId);
  if (session.type !== "ssh") throw new Error(`session "${sessionId}" is not an SSH session`);
  return sessionId;
}

export function isRemoteSession(api: PluginAPI, sessionId: string): boolean {
  return requireShellSession(api, sessionId).type === "ssh";
}
