import { useNotificationStore } from "@/stores/notificationStore";

export function toastSecretFailure(message: string, severity: "warning" | "error" = "error"): void {
  useNotificationStore.getState().addToast({ source: { kind: "plugin", id: "system", name: "Voltius" }, type: "toast", message, severity, duration: 10000 });
}
