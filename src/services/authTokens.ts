import { invoke } from "@tauri-apps/api/core";
import { appFetch } from "@/services/http";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

export async function getJwt(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "jwt" });
}

export async function getServerUrl(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "server_url" });
}

export function isJwtExpiredOrExpiring(jwt: string): boolean {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return Date.now() > payload.exp * 1000 - 60_000; // refresh 60s before expiry
  } catch {
    return true;
  }
}

/** Try to refresh the access token using the stored refresh_token. Returns new JWT or null. */
export async function tryRefreshJwt(): Promise<string | null> {
  const [refreshToken, serverUrl] = await Promise.all([
    invoke<string | null>("keychain_get", { key: "refresh_token" }),
    getServerUrl(),
  ]);
  if (!refreshToken || !serverUrl) return null;
  const res = await appFetch(`${serverUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return null;
  const { jwt_token } = await res.json();
  await invoke("keychain_set", { key: "jwt", value: jwt_token });
  await useSubscriptionStore.getState().load().catch(() => undefined);
  return jwt_token;
}
