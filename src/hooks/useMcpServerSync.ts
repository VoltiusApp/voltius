import { useEffect } from "react";
import { useToggle } from "@/stores/toggleSettingsStore";
import { syncMcpServer } from "@/mcp/enable";
import { getPlatform, isMobilePlatform } from "@/utils/platform";

/**
 * Mount once at the app root. The socket is off by default; this pushes the
 * current toggle value to the backend on mount and on every flip.
 *
 * Phones (Android, iOS) have no MCP server: the toggle is a synced setting, so a desktop that
 * turned it on hands `true` to the phone. Skip the push there and never write
 * the toggle back, or a `false` would sync out and switch desktop off.
 */
export function useMcpServerSync() {
  const [enabled, setEnabled] = useToggle("mcp-server");

  useEffect(() => {
    let cancelled = false;
    void getPlatform().then((os) => {
      if (cancelled || isMobilePlatform(os)) return;
      void syncMcpServer(enabled).catch((err) => {
        console.error("[mcp] could not change the server state", err);
        // The listener never came up. Leaving the toggle on would advertise a
        // server that does not exist, and clients would just report the app is
        // not running.
        if (enabled) setEnabled(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, setEnabled]);
}
