import { refuseWhilePreviewing, type PreviewTarget } from "@/services/previewGuard";
import type { SheetAction } from "./SheetActionRow";

export function previewGuarded(actions: SheetAction[], target: PreviewTarget | undefined): SheetAction[] {
  return actions.map((a) =>
    a.reads || a.disabled || a.disabledReason !== undefined
      ? a
      : { ...a, onTap: () => { if (!refuseWhilePreviewing(target)) a.onTap(); } });
}
