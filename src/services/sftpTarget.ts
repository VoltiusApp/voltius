import { sftpOpen, sftpConnect, ftpConnect, webdavConnect } from "@/services/sftp";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import { resolveFirstHopProxy } from "@/services/proxy";
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
  return connectFileBackend(target.connection, genId());
}

/** `interactive`: only a caller that renders the host-key conflict overlay for `connectId`. */
export async function connectFileBackend(conn: Connection, connectId: string, interactive = false): Promise<string> {
  if (conn.connection_type === "ftp") {
    const creds = await resolveConnectionCredentials(conn);
    return ftpConnect({ host: conn.host, port: conn.port, username: creds.username, password: creds.password, secure: !!conn.ftp_secure });
  }
  if (conn.connection_type === "webdav") {
    const [creds, proxy] = await Promise.all([resolveConnectionCredentials(conn), resolveFirstHopProxy(conn)]);
    return webdavConnect({ connectId, url: conn.webdav_url ?? "", username: creds.username, password: creds.password, proxy, interactive });
  }
  return sftpConnectToConnection(conn, connectId);
}

export async function sftpConnectToConnection(conn: Connection, connectId: string): Promise<string> {
  const [creds, jumpHosts, proxy] = await Promise.all([
    resolveConnectionCredentials(conn),
    resolveJumpHosts(conn),
    resolveFirstHopProxy(conn),
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
    proxy,
  });
}
