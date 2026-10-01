import { useNotificationStore } from "@/stores/notificationStore";

export function notifyError(err: unknown): void {
  useNotificationStore.getState().addToast({
    source: { kind: "plugin", id: "core", name: "Voltius" },
    type: "toast",
    message: err instanceof Error ? err.message : String(err),
    severity: "error",
    duration: 4000,
  });
}
