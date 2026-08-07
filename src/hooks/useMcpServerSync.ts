import { useEffect } from "react";
import { useToggle } from "@/stores/toggleSettingsStore";
import { syncMcpServer } from "@/mcp/enable";

/**
 * Mount once at the app root. The socket is off by default; this pushes the
 * current toggle value to the backend on mount and on every flip.
 */
export function useMcpServerSync() {
  const [enabled] = useToggle("mcp-server");

  useEffect(() => {
    void syncMcpServer(enabled);
  }, [enabled]);
}
