import type { Connection, TerminalSession } from "@/types";
import type { CredentialPlan } from "@/services/credentialPlan";
import { effectiveUsername } from "@/services/credentialScope";

export function needsConnectionOverlay(session: TerminalSession): boolean {
  if (session.type === "multiplayer") return false;
  return session.status === "connecting" || session.status === "error";
}

export function sshOverlaySubtitle(conn: Pick<Connection, "username" | "host" | "port">, plan: CredentialPlan, skipPick = false): string {
  return `${effectiveUsername(conn, skipPick ? { kind: "host" } : plan)}@${conn.host}:${conn.port}`;
}

export function sessionUserAtHost(session: Pick<TerminalSession, "connectedUsername"> | undefined, conn: Pick<Connection, "username" | "host">): string {
  return `${session?.connectedUsername ?? conn.username}@${conn.host}`;
}
