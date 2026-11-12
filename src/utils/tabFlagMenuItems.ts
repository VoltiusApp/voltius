import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { useLayoutStore } from "@/stores/layoutStore";
import { isPinnedKey, setTabLocked, type TabTarget } from "@/services/tabLock";

export function tabFlagMenuItems(
  t: TFunction,
  { pinKey, lockTarget, locked, scope }: { pinKey: string; lockTarget: TabTarget; locked: boolean; scope: "tab" | "pane" },
): ContextMenuItem[] {
  const pinned = isPinnedKey(pinKey);
  const lockKey = scope === "pane" ? (locked ? "unlockPane" : "lockPane") : (locked ? "unlockTab" : "lockTab");
  return [
    {
      label: t(pinned ? "layout.titleBar.lock.unpinTab" : "layout.titleBar.lock.pinTab"),
      icon: pinned ? "lucide:pin-off" : "lucide:pin",
      onClick: () => useLayoutStore.getState().setPinned(pinKey, !pinned),
    },
    {
      label: t(`layout.titleBar.lock.${lockKey}`),
      icon: locked ? "lucide:lock-open" : "lucide:lock",
      onClick: () => setTabLocked(lockTarget, !locked),
    },
  ];
}
