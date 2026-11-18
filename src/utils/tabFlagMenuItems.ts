import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { useLayoutStore } from "@/stores/layoutStore";
import { isPinnedKey, setTabLocked, type TabTarget } from "@/services/tabLock";

export interface TabFlagAction {
  id: "pin" | "unpin" | "lock" | "unlock";
  label: string;
  icon: string;
  run: () => void;
}

export function tabFlagActions(
  t: TFunction,
  { pinKey, lockTarget, locked, scope }: { pinKey: string; lockTarget: TabTarget; locked: boolean; scope: "tab" | "pane" },
): TabFlagAction[] {
  const pinned = isPinnedKey(pinKey);
  const lockKey = scope === "pane" ? (locked ? "unlockPane" : "lockPane") : (locked ? "unlockTab" : "lockTab");
  return [
    {
      id: pinned ? "unpin" : "pin",
      label: t(pinned ? "layout.titleBar.lock.unpinTab" : "layout.titleBar.lock.pinTab"),
      icon: pinned ? "lucide:pin-off" : "lucide:pin",
      run: () => useLayoutStore.getState().setPinned(pinKey, !pinned),
    },
    {
      id: locked ? "unlock" : "lock",
      label: t(`layout.titleBar.lock.${lockKey}`),
      icon: locked ? "lucide:lock-open" : "lucide:lock",
      run: () => setTabLocked(lockTarget, !locked),
    },
  ];
}

export function tabFlagMenuItems(t: TFunction, opts: Parameters<typeof tabFlagActions>[1]): ContextMenuItem[] {
  return tabFlagActions(t, opts).map(({ label, icon, run }) => ({ label, icon, onClick: run }));
}
