import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUIStore } from "@/stores/uiStore";
import { usePortForwardingSettingsStore } from "@/stores/portForwardingSettingsStore";

interface PfPortDetectedPayload {
  session_id: string;
  port: number;
  tunnel_local_port: number;
}

const BATCH_DELAY_MS = 800;

export function usePfToastBridge() {
  const pendingPorts = useRef<PfPortDetectedPayload[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    function flush() {
      const ports = pendingPorts.current;
      if (ports.length === 0) return;
      pendingPorts.current = [];

      const { addToast, updateToast } = useNotificationStore.getState();
      const { setRightPanelOpen, setRightPanelSection } = useUIStore.getState();

      const openPanel = () => {
        setRightPanelSection("ports");
        setRightPanelOpen(true);
      };

      const message =
        ports.length === 1
          ? `Port ${ports[0].port} → localhost:${ports[0].tunnel_local_port} forwarded`
          : `${ports.length} ports forwarded`;

      if (toastIdRef.current) {
        updateToast(toastIdRef.current, {
          message,
          duration: 5000,
          action: { label: "View Ports →", onClick: openPanel },
        });
      } else {
        const id = addToast({
          pluginId: "__pf__",
          pluginName: "Port Forwarding",
          type: "toast",
          message,
          severity: "info",
          duration: 5000,
          action: { label: "View Ports →", onClick: openPanel },
        });
        toastIdRef.current = id;
      }
    }

    const unlistenPromise = listen<PfPortDetectedPayload>("pf-port-detected", ({ payload }) => {
      if (!usePortForwardingSettingsStore.getState().autoForwardNotificationsEnabled) return;
      pendingPorts.current.push(payload);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flush();
        // Allow a new toast for the next burst
        setTimeout(() => { toastIdRef.current = null; }, 5000);
      }, BATCH_DELAY_MS);
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unlistenPromise.then((f) => f());
    };
  }, []);
}
