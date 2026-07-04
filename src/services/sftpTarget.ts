import { sftpOpen, sftpConnect } from "@/services/sftp";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import { resolveKeepalive } from "@/utils/keepalive";
import { getGlobalKeepalivePreset } from "@/stores/connectivitySettingsStore";
import { genId } from "@/components/filetransfer/SFTPTypes";
import type { Connection } from "@/types";

export type RunTarget =
  | { kind: "session"; sessionId: string; sessionType: string }
  | { kind: "connection"; connection: Connection };

export async function resolveSftpIdForTarget(target: RunTarget): Promise<string> {
  if (target.kind === "session") {
    return sftpOpen(target.sessionId);
  }
  const conn = target.connection;
  const [creds, jumpHosts] = await Promise.all([
    resolveConnectionCredentials(conn),
    resolveJumpHosts(conn),
  ]);
  const ka = resolveKeepalive(conn.keepalive_preset ?? getGlobalKeepalivePreset());
  return sftpConnect({
    connectId: genId(),
    host: conn.host,
    port: conn.port,
    username: creds.username,
    password: creds.password,
    privateKey: creds.privateKey,
    passphrase: creds.passphrase,
    jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
    keepaliveIntervalSecs: ka.intervalSecs,
    keepaliveMax: ka.max,
  });
}
