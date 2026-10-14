import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";

export function toastSecretFailure(message: string, severity: "warning" | "error" = "error"): void {
  useNotificationStore.getState().addToast({ source: APP_SOURCE, type: "toast", message, severity, duration: 10000 });
}
