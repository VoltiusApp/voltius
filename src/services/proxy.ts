import type { Connection, ProxyOverride } from "@/types";
import { getSecret } from "@/services/vault";
import { getGlobalProxy } from "@/stores/connectivitySettingsStore";
import { GLOBAL_PROXY_PASSWORD_KEY, proxyPasswordKey } from "@/services/teamVaultSecretKeys";

export type ProxySpec =
  | { kind: "direct" }
  | { kind: "system" }
  | { kind: "socks5" | "http"; host: string; port: number; username?: string; password?: string };

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
      if (!source.host || !source.port) return null;
      const password = overrides?.password ?? (await getSecret(secretKey).catch(() => null)) ?? undefined;
      return {
        kind: source.mode,
        host: source.host,
        port: source.port,
        ...(source.username ? { username: source.username } : {}),
        ...(password ? { password } : {}),
      };
    }
  }
}
