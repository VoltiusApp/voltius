import { useNotificationStore } from "@/stores/notificationStore";

export interface TeamActionFeedbackOptions<T> {
  pending: string;
  success: string | ((result: T) => string);
  error?: string | ((error: Error) => string);
  run: () => Promise<T>;
}

export async function runTeamAction<T>({
  pending,
  success,
  error,
  run,
}: TeamActionFeedbackOptions<T>): Promise<T> {
  const store = useNotificationStore.getState();
  const toastId = store.addToast({
    pluginId: "system",
    pluginName: "Voltius",
    type: "progress",
    message: pending,
    severity: "info",
    duration: 0,
  });

  try {
    const result = await run();
    store.updateToast(toastId, {
      type: "toast",
      message: typeof success === "function" ? success(result) : success,
      severity: "success",
      duration: 3500,
      finished: true,
      finishedSeverity: "success",
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
