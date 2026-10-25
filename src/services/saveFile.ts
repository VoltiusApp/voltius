import { invoke } from "@/lib/invoke";
import { saveSystemDialog as save } from "@/services/systemDialog";
import i18n from "@/i18n";
import { appToast } from "@/services/appToast";
import { documentDir, join } from "@tauri-apps/api/path";
import { getPlatformSync, isMobileShell } from "@/utils/platform";

const MIME: Record<string, string> = { json: "application/json", csv: "text/csv" };

export function notify(severity: "success" | "error", message: string) {
  appToast(severity, message);
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
  // iOS: no save dialog and no blob downloads in WKWebView; Documents shows in the Files app.
  if (getPlatformSync() === "ios") {
    try {
      const path = await join(await documentDir(), filename);
      await invoke("fs_write_file", { path, content });
      notify("success", i18n.t("common.toast.fileSaved", { path: `Files › Voltius › ${filename}` }));
      return true;
    } catch (e) {
      notify("error", i18n.t("common.toast.fileSaveFailed", { error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }
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
