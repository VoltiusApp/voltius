import { invoke } from "@/lib/invoke";
import type { Connection, CustomProxyMode, ProxyOverride } from "@/types";
import i18n from "@/i18n";
import { getSecret } from "@/services/vault";
import { firstHopConnection, resolveKnock, type KnockOverride, type KnockSpec } from "@/services/portKnock";
import { getGlobalProxy } from "@/stores/connectivitySettingsStore";
import { GLOBAL_PROXY_PASSWORD_KEY, proxyPasswordKey } from "@/services/teamVaultSecretKeys";

export type ProxySpec =
  | { kind: "direct" }
  | { kind: "system" }
  | { kind: CustomProxyMode; host: string; port: number; username?: string; password?: string };

export const DEFAULT_PROXY_PORT: Record<CustomProxyMode, number> = { socks5: 1080, http: 8080, https: 443 };

export const isCustomProxyMode = (mode: string | undefined): mode is CustomProxyMode =>
  mode !== undefined && Object.prototype.hasOwnProperty.call(DEFAULT_PROXY_PORT, mode);

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
    case "http":
    case "https": {
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

export interface HopRoute { proxy: ProxySpec | null; knock: KnockSpec | null }

export async function resolveDirectHop(
  conn: Pick<Connection, "id" | "proxy" | "port_knock">,
  overrides?: { proxy?: ProxyOverride | null; password?: string; knock?: KnockOverride },
): Promise<HopRoute> {
  const [proxy, knock] = await Promise.all([resolveProxy(conn, overrides), resolveKnock(conn, overrides?.knock)]);
  return { proxy, knock };
}

export function firstHopProxy(conn: Connection): Promise<ProxySpec | null> {
  const dialed = firstHopConnection(conn);
  return resolveProxy(dialed?.proxy ? dialed : conn);
}

export async function resolveFirstHop(conn: Connection): Promise<HopRoute> {
  const [proxy, knock] = await Promise.all([firstHopProxy(conn), resolveKnock(firstHopConnection(conn))]);
  return { proxy, knock };
}

export interface DetectedProxy {
  kind: CustomProxyMode;
  host: string;
  port: number;
}

export function detectSystemProxy(): Promise<DetectedProxy | null> {
  return invoke<DetectedProxy | null>("proxy_detect_system");
}
