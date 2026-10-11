import { invoke } from "@/lib/invoke";
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

let revoked = false;
let revokedToast: string | null = null;

export function clearSessionRevoked(): void {
  revoked = false;
  if (!revokedToast) return;
  const id = revokedToast;
  revokedToast = null;
  void import("@/stores/notificationStore").then(({ useNotificationStore }) =>
    useNotificationStore.getState().dismissToast(id));
}

async function announceSessionRevoked(): Promise<void> {
  const [{ useNotificationStore }, { useUIStore }, { default: i18n }] = await Promise.all([
    import("@/stores/notificationStore"),
    import("@/stores/uiStore"),
    import("@/i18n"),
  ]);
  if (!revoked || revokedToast) return;
  revokedToast = useNotificationStore.getState().addToast({
    source: { kind: "plugin", id: "system", name: "Voltius" },
    type: "toast",
    message: i18n.t("common.toast.sessionRevoked"),
    severity: "warning",
    duration: 0,
    action: {
      label: i18n.t("common.toast.signInAgain"),
      onClick: () => useUIStore.getState().openCloudAuth("signin", "reauth"),
    },
  });
}

export type RefreshOutcome = { jwt: string } | "revoked" | "failed" | "no-session";

/**
 * The one caller of /v1/auth/refresh. A 401 means the server ended this session;
 * it is remembered so the sync loop stops asking, and the user is told once.
 */
export async function refreshAccessToken(
  { fetchImpl = appFetch, quiet = false }: {
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    quiet?: boolean;
  } = {},
): Promise<RefreshOutcome> {
  const [refreshToken, serverUrl] = await Promise.all([
    invoke<string | null>("keychain_get", { key: "refresh_token" }),
    getServerUrl(),
  ]);
  if (!refreshToken || !serverUrl) return "no-session";
  if (revoked) return "revoked";
  const res = await fetchImpl(`${serverUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (res.status === 401) {
    // A pair adopted while this request was in flight (password change, two-factor) supersedes its answer.
    const current = await invoke<string | null>("keychain_get", { key: "refresh_token" });
    if (current !== refreshToken) return refreshAccessToken({ fetchImpl, quiet });
    revoked = true;
    // `quiet` for a caller that is about to sign in again by itself.
    if (!quiet) void announceSessionRevoked().catch(() => undefined);
    return "revoked";
  }
  if (!res.ok) return "failed";
  const { jwt_token } = await res.json();
  await invoke("keychain_set", { key: "jwt", value: jwt_token });
  return { jwt: jwt_token };
}

/** Try to refresh the access token using the stored refresh_token. Returns new JWT or null. */
export async function tryRefreshJwt(): Promise<string | null> {
  const outcome = await refreshAccessToken();
  if (typeof outcome === "string") return null;
  await useSubscriptionStore.getState().load().catch(() => undefined);
  return outcome.jwt;
}
