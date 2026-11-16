import { refuseWhilePreviewing, type PreviewTarget } from "@/services/previewGuard";
import { isSheetActionDisabled, type SheetAction } from "./SheetActionRow";

export function previewGuarded(actions: SheetAction[], target: PreviewTarget | undefined, close: () => void): SheetAction[] {
  return actions.map((a) =>
    a.reads || isSheetActionDisabled(a)
      ? a
      : { ...a, onTap: () => { if (refuseWhilePreviewing(target)) close(); else a.onTap(); } });
}
