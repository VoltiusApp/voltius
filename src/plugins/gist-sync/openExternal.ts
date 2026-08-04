// Vendored for the same reason as ./clipboard: external plugin bundles cannot
// reach across the host-internal path boundary. A plain anchor opening a new tab
// is a silent no-op in the Tauri webview (#74), so every outbound link goes
// through the opener plugin.
import { openUrl } from "@tauri-apps/plugin-opener";

export function openExternal(url: string): void {
  void openUrl(url).catch(() => {});
}
