import { invoke } from "@tauri-apps/api/core";
import { onContributionsChanged } from "./contributions";

const DEBOUNCE_MS = 250;

/**
 * Pushes one `tools/list_changed` per burst of registry changes. Six bundled
 * plugins load at boot; without the debounce that is six notifications, each
 * of which makes every connected client re-list.
 */
export function startToolsChangedNotifier(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = onContributionsChanged(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void invoke("mcp_notify_tools_changed").catch(() => {
        // The server may be off, or the command may not exist on an older
        // backend. Neither is worth surfacing.
      });
    }, DEBOUNCE_MS);
  });
  return () => {
    off();
    if (timer) clearTimeout(timer);
  };
}
