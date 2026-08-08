import { useEffect } from "react";
import { useToggle } from "@/stores/toggleSettingsStore";
import { syncMcpServer } from "@/mcp/enable";

/**
 * Mount once at the app root. The socket is off by default; this pushes the
 * current toggle value to the backend on mount and on every flip.
 */
export function useMcpServerSync() {
  const [enabled, setEnabled] = useToggle("mcp-server");

  useEffect(() => {
    void syncMcpServer(enabled).catch((err) => {
      console.error("[mcp] could not change the server state", err);
      // The listener never came up. Leaving the toggle on would advertise a
      // server that does not exist, and clients would just report the app is
      // not running.
      if (enabled) setEnabled(false);
    });
  }, [enabled, setEnabled]);
}
