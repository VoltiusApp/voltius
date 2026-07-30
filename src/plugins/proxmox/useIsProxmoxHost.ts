import { useEffect, useState } from "react";
import type { PluginAPI, PluginSession } from "@/plugins/api";

/**
 * Whether the given session's connection is a Proxmox VE host. Unlike the
 * pre-migration `useConnectionStore` selector (synchronous, reactive, no gap),
 * this resolves through `api.connections.get`, a real IPC round trip — plugins
 * have no direct access to the already-loaded connection store. Returns `null`
 * while unresolved so a caller can avoid rendering a false "not a Proxmox host"
 * placeholder during that gap; it only ever becomes `true`/`false` once the
 * lookup for the *current* session has actually completed.
 */
export function useIsProxmoxHost(
  api: PluginAPI | null,
  session: PluginSession | null | undefined,
): boolean | null {
  const [isProxmoxHost, setIsProxmoxHost] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setIsProxmoxHost(null);
      return;
    }
    setIsProxmoxHost(null);
    api?.connections.get(session.connectionId).then((c) => {
      if (!cancelled) setIsProxmoxHost(c?.distro === "proxmox");
    });
    return () => {
      cancelled = true;
    };
  }, [api, session?.connectionId]);

  return isProxmoxHost;
}
