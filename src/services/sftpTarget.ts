import { sftpOpen, sftpConnect } from "@/services/sftp";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import { resolveKeepalive } from "@/utils/keepalive";
import { getGlobalKeepalivePreset } from "@/stores/connectivitySettingsStore";
import { genId } from "@/components/filetransfer/SFTPTypes";
import type { Connection, TerminalSession } from "@/types";
import type { DynamicContext } from "@/services/snippetParser";

export type RunTarget =
  | {
      kind: "session";
      sessionId: string;
      sessionType: TerminalSession["type"];
      /** Pre-captured `{{connection.*}}` values, for callers whose session row may
       *  be gone by the time the sequence resolves them (e.g. post-commands). */
      context?: Omit<DynamicContext, "clipboard">;
      /** Pre-captured display label, for the same reason. */
      label?: string;
    }
  | { kind: "connection"; connection: Connection };

export async function resolveSftpIdForTarget(target: RunTarget): Promise<string> {
  if (target.kind === "session") {
    return sftpOpen(target.sessionId);
  }
  return sftpConnectToConnection(target.connection, genId());
}

export async function sftpConnectToConnection(conn: Connection, connectId: string): Promise<string> {
  const [creds, jumpHosts] = await Promise.all([
    resolveConnectionCredentials(conn),
    resolveJumpHosts(conn),
  ]);
  const ka = resolveKeepalive(conn.keepalive_preset ?? getGlobalKeepalivePreset());
  return sftpConnect({
    connectId,
    host: conn.host,
    port: conn.port,
    username: creds.username,
    password: creds.password,
    privateKey: creds.privateKey,
    passphrase: creds.passphrase,
    jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
    keepaliveIntervalSecs: ka.intervalSecs,
    keepaliveMax: ka.max,
    legacyAlgorithms: conn.legacy_algorithms,
  });
}
