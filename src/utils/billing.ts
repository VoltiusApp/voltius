import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

export async function openPortal(): Promise<void> {
  const jwt = await invoke<string | null>("keychain_get", { key: "jwt" }).catch(() => null);
  const url = jwt
    ? `https://app.voltius.app/account?token=${encodeURIComponent(jwt)}`
    : "https://app.voltius.app/account";
  await openUrl(url).catch(() => {});
}
