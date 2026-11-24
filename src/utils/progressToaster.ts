import { APP_SOURCE, useNotificationStore, type ToastEntry } from "@/stores/notificationStore";

export type ToastFields = Omit<Partial<ToastEntry>, "id" | "createdAt">;

/** One progress toast, added on the first `show` and updated in place after that. */
export function progressToaster(base: ToastFields) {
  const store = useNotificationStore.getState();
  let id: string | null = null;
  return {
    get id() { return id; },
    show(fields: ToastFields) {
      if (id) store.updateToast(id, fields);
      else id = store.addToast({ source: APP_SOURCE, type: "progress", severity: "info", duration: 0, message: "", ...base, ...fields });
    },
    update(fields: ToastFields) {
      if (id) store.updateToast(id, fields);
    },
    adopt(existing: string) { id = existing; },
  };
}

export type ProgressToaster = ReturnType<typeof progressToaster>;
