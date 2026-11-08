import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";

export interface TeamActionFeedbackOptions<T> {
  pending: string;
  success: string | ((result: T) => string);
  warning?: (result: T) => string | null;
  error?: string | ((error: Error) => string);
  run: () => Promise<T>;
}

export async function runTeamAction<T>({
  pending,
  success,
  error,
  warning,
  run,
}: TeamActionFeedbackOptions<T>): Promise<T> {
  const store = useNotificationStore.getState();
  const toastId = store.addToast({
    source: APP_SOURCE,
    type: "progress",
    message: pending,
    severity: "info",
    duration: 0,
  });

  try {
    const result = await run();
    const warned = warning?.(result);
    store.updateToast(toastId, {
      type: "toast",
      message: warned ?? (typeof success === "function" ? success(result) : success),
      severity: warned ? "warning" : "success",
      duration: warned ? 7000 : 3500,
      finished: true,
      finishedSeverity: warned ? "warning" : "success",
    });
    return result;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    store.updateToast(toastId, {
      type: "toast",
      message: typeof error === "function" ? error(err) : error ?? err.message,
      severity: "error",
      duration: 7000,
      finished: true,
      finishedSeverity: "error",
    });
    throw err;
  }
}
