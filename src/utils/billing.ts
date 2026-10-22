import { CAN_OPEN_CHECKOUT } from "@/services/distribution";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@/lib/invoke";
import { isDefaultServer } from "@/utils/serverInstance";

export async function openPortal(): Promise<void> {
  if (!CAN_OPEN_CHECKOUT) return;
  const [serverUrl, jwt] = await Promise.all([
    invoke<string | null>("keychain_get", { key: "server_url" }).catch(() => null),
    invoke<string | null>("keychain_get", { key: "jwt" }).catch(() => null),
  ]);
  // app.voltius.app only knows cloud accounts; a self-hosted token must never leave its own server.
  const url = jwt && serverUrl && isDefaultServer(serverUrl)
    ? `https://app.voltius.app/account?token=${encodeURIComponent(jwt)}`
    : "https://app.voltius.app/account";
  await openUrl(url).catch(() => {});
}
