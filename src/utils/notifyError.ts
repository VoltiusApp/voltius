import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";

export function notifyError(err: unknown): void {
  useNotificationStore.getState().addToast({
    source: APP_SOURCE,
    type: "toast",
    message: err instanceof Error ? err.message : String(err),
    severity: "error",
    duration: 4000,
  });
}
