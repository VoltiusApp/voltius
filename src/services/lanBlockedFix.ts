import type { TFunction } from "i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SheetAction } from "@/components/mobile/sheets/SheetActionRow";
import { logFailure } from "@/lib/logger";

const LOCAL_NETWORK_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork";

function blockedKey(platform: string | null): string {
  if (platform === "macos") return "layout.sync.local.status.blocked";
  if (platform === "windows") return "layout.sync.local.status.blockedOther";
  return "layout.sync.local.status.blockedNetwork";
}

export function blockedFix(t: TFunction, platform: string | null) {
  const action: SheetAction | null = platform === "macos"
    ? { slug: "open-settings", icon: "lucide:settings", label: t("layout.sync.local.openSettings"), onTap: () => void openUrl(LOCAL_NETWORK_SETTINGS).catch(logFailure("lan-sync open settings")) }
    : null;
  return { icon: "lucide:wifi-off", color: "var(--t-status-warning)", label: t(blockedKey(platform)), action };
}
