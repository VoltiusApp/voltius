import { invoke } from "@tauri-apps/api/core";
import type { Connection, ProxyOverride } from "@/types";
import i18n from "@/i18n";
import { getSecret } from "@/services/vault";
import { findConnection } from "@/services/credentials";
import { getGlobalProxy } from "@/stores/connectivitySettingsStore";
import { GLOBAL_PROXY_PASSWORD_KEY, proxyPasswordKey } from "@/services/teamVaultSecretKeys";

export type ProxySpec =
  | { kind: "direct" }
  | { kind: "system" }
  | { kind: "socks5" | "http"; host: string; port: number; username?: string; password?: string };

export const DEFAULT_PROXY_PORT = { socks5: 1080, http: 8080 } as const;

export const isCustomProxyMode = (mode: string | undefined): mode is keyof typeof DEFAULT_PROXY_PORT =>
  mode === "socks5" || mode === "http";

export async function resolveProxy(
  conn: Pick<Connection, "id" | "proxy">,
  overrides?: { proxy?: ProxyOverride | null; password?: string },
): Promise<ProxySpec | null> {
  const perHost = overrides?.proxy !== undefined ? overrides.proxy : conn.proxy;
  const source = perHost ?? getGlobalProxy();
  const secretKey = perHost ? proxyPasswordKey(conn.id) : GLOBAL_PROXY_PASSWORD_KEY;
  switch (source.mode) {
    case "none":
      return null;
    case "direct":
      return { kind: "direct" };
    case "system":
      return { kind: "system" };
    case "socks5":
    case "http": {
      const host = source.host?.trim();
      if (!host) {
        throw new Error(i18n.t("connections.form.proxy.hostMissing", { kind: i18n.t(`connections.form.proxy.modes.${source.mode}`) }));
      }
      const password = overrides?.password ?? (await getSecret(secretKey).catch(() => null)) ?? undefined;
      return {
        kind: source.mode,
        host,
        port: source.port || DEFAULT_PROXY_PORT[source.mode],
        ...(source.username ? { username: source.username } : {}),
        ...(password ? { password } : {}),
      };
    }
  }
}

export function resolveFirstHopProxy(conn: Connection): Promise<ProxySpec | null> {
  const firstJump = conn.jump_hosts?.[0];
  const bastion = firstJump ? findConnection(firstJump.connection_id) : undefined;
  return resolveProxy(bastion?.proxy ? bastion : conn);
}

export interface DetectedProxy {
  kind: "socks5" | "http";
  host: string;
  port: number;
}

export function detectSystemProxy(): Promise<DetectedProxy | null> {
  return invoke<DetectedProxy | null>("proxy_detect_system");
}
