import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import { describeError } from "@/services/backendErrors";
import { sftpCancelTransfer, sftpClose, sftpDelete, sftpOpen } from "@/services/sftp";
import { pasteToSession } from "@/services/terminalPaste";
import { sessionAcceptsInput } from "@/hooks/useTerminal";
import { broadcastActiveForSession } from "@/stores/layoutStore";
import { APP_SOURCE, useNotificationStore, type ToastEntry } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getToggle } from "@/stores/toggleSettingsStore";
import { useUIStore } from "@/stores/uiStore";
import { formatSize } from "@/components/filetransfer/SFTPTypes";

interface ClipboardImage {
  id: number;
  width: number;
  height: number;
  size: number;
  thumbnail: string;
}

export const SHOW_PROGRESS_AFTER_MS = 250;
const DONE_MS = 3500;
const FIRST_USE_MS = 10_000;

/** Single-quote `path` for a POSIX shell unless every character is already safe. */
export function shellQuotePath(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

const queues = new Map<string, Promise<void>>();

/** Run uploads for one session in order, so two quick pastes type their paths in paste order. */
function enqueue(sessionId: string, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(sessionId) ?? Promise.resolve()).then(job, job);
  queues.set(sessionId, next);
  return next;
}

function hostOf(sessionId: string): string {
  return useSessionStore.getState().sessions.find((s) => s.id === sessionId)?.connectionName ?? "";
}

type ToastFields = Omit<Partial<ToastEntry>, "id" | "createdAt">;

function toaster(thumbnail: string) {
  const store = useNotificationStore.getState();
  let id: string | null = null;
  return {
    get id() { return id; },
    show(fields: ToastFields) {
      if (id) store.updateToast(id, fields);
      else id = store.addToast({ source: APP_SOURCE, type: "progress", severity: "info", duration: 0, message: "", thumbnail, ...fields });
    },
    update(fields: ToastFields) {
      if (id) store.updateToast(id, fields);
    },
    adopt(existing: string) { id = existing; },
  };
}

async function deleteFromHost(sessionId: string, path: string, toast: ReturnType<typeof toaster>) {
  const t = i18n.t;
  try {
    const sftpId = await sftpOpen(sessionId);
    try {
      await sftpDelete(sftpId, path);
    } finally {
      await sftpClose(sftpId).catch(() => {});
    }
    toast.update({ message: t("terminal.pasteImage.deleted"), action: undefined });
  } catch (e) {
    toast.update({ finishedSeverity: "error", message: t("terminal.pasteImage.deleteFailed"), detail: describeError(e, t), action: undefined });
  }
}

async function upload(sessionId: string, image: ClipboardImage, retryOf?: string): Promise<void> {
  const t = i18n.t;
  const host = hostOf(sessionId);
  const transferId = crypto.randomUUID();
  const toast = toaster(image.thumbnail);
  if (retryOf) toast.adopt(retryOf);
  let progress = 0;
  let cancelled = false;
  const showProgress = () => toast.show({
    message: t("terminal.pasteImage.uploading"),
    detail: t("terminal.pasteImage.uploadingDetail", { host, size: formatSize(image.size), width: image.width, height: image.height }),
    severity: "info",
    progress,
    finished: false,
    cancellable: true,
    action: undefined,
    duration: 0,
    onCancel: () => {
      cancelled = true;
      void sftpCancelTransfer(transferId);
    },
  });
  const timer = retryOf ? (showProgress(), undefined) : setTimeout(showProgress, SHOW_PROGRESS_AFTER_MS);
  const unlisten = await listen<{ transferred: number; total: number }>(`sftp-progress-${transferId}`, ({ payload }) => {
    progress = payload.total ? (payload.transferred / payload.total) * 100 : 0;
    toast.update({ progress });
  });
  try {
    const path = await invoke<string>("paste_image_upload", { sessionId, imageId: image.id, transferId });
    clearTimeout(timer);
    // The trailing space keeps back-to-back pastes from running into one path.
    await pasteToSession(sessionId, `${shellQuotePath(path)} `);
    const ui = useUIStore.getState();
    const firstUse = !ui.imagePasteNoticeSeen;
    if (firstUse) ui.markImagePasteNoticeSeen();
    toast.show({
      finished: true,
      finishedSeverity: "success",
      cancellable: false,
      message: t("terminal.pasteImage.pasted"),
      detail: firstUse ? t("terminal.pasteImage.firstUse") : t("terminal.pasteImage.pastedDetail", { host, name: path.split("/").pop() }),
      duration: firstUse ? FIRST_USE_MS : DONE_MS,
      action: firstUse
        ? { label: t("terminal.pasteImage.settings"), onClick: () => useUIStore.getState().openSettings("terminal") }
        : { label: t("terminal.pasteImage.deleteFromHost"), onClick: () => void deleteFromHost(sessionId, path, toast) },
    });
  } catch (e) {
    clearTimeout(timer);
    if (cancelled) return;
    toast.show({
      finished: true,
      finishedSeverity: "error",
      cancellable: false,
      message: t("terminal.pasteImage.failed"),
      detail: host ? `${host}: ${describeError(e, t)}` : describeError(e, t),
      action: { label: t("terminal.pasteImage.retry"), onClick: () => void enqueue(sessionId, () => upload(sessionId, image, toast.id ?? undefined)) },
    });
  } finally {
    unlisten();
  }
}

/** Tools on the host (e.g. Claude Code) can't reach this machine's clipboard, so
 *  the image is uploaded next to them and its path typed in. */
export async function pasteClipboardImage(sessionId: string): Promise<void> {
  if (!getToggle("paste-image-as-path") || !sessionAcceptsInput(sessionId)) return;
  if (broadcastActiveForSession(sessionId)) {
    useNotificationStore.getState().addToast({
      source: APP_SOURCE, type: "toast", severity: "info", duration: 5000,
      message: i18n.t("terminal.pasteImage.broadcast"),
    });
    return;
  }
  const image = await invoke<ClipboardImage | null>("paste_image_read").catch(() => null);
  if (!image) return;
  await enqueue(sessionId, () => upload(sessionId, image));
}
