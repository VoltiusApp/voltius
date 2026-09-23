import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import { isMobileShell } from "@/utils/platform";

const MIME: Record<string, string> = { json: "application/json", csv: "text/csv" };

function notify(severity: "success" | "error", message: string) {
  useNotificationStore.getState().addToast({
    source: { kind: "plugin", id: "system", name: "Voltius" },
    type: "toast",
    message,
    severity,
    duration: severity === "error" ? 8000 : 4000,
  });
}

function blobDownload(filename: string, content: string, ext: string) {
  const url = URL.createObjectURL(new Blob([content], { type: MIME[ext] ?? "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Asks where to save `content`, writes it, and toasts the outcome. Resolves false when cancelled or failed. */
export async function saveTextFile(filename: string, content: string): Promise<boolean> {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  // The Android WebView has no native save dialog path we can write to directly.
  if (isMobileShell()) {
    blobDownload(filename, content, ext);
    return true;
  }
  try {
    const path = await save({ defaultPath: filename, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await invoke("fs_write_file", { path, content });
    notify("success", i18n.t("common.toast.fileSaved", { path }));
    return true;
  } catch (e) {
    notify("error", i18n.t("common.toast.fileSaveFailed", { error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
