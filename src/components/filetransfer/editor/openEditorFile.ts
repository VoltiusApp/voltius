import { useEditorStore } from "@/stores/editorStore";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";

/** Open `path` in an editor tab with the user's auto-save default; text or image is decided on read. */
export function openEditorFile(args: { sftpId: string | null; path: string; hostLabel: string }): string {
  return useEditorStore.getState().openDoc({ ...args, autoSave: useSftpSettingsStore.getState().editorAutoSave });
}
