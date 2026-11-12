import { useTranslation } from "react-i18next";
import type { TerminalSession } from "@/types";
import BottomSheet from "./BottomSheet";
import { SheetActionRow } from "./SheetActionRow";
import { sessionLabel } from "@/utils/sessionLabel";
import { closeSessionTabs } from "@/services/closeSession";
import { setTabLocked } from "@/services/tabLock";
import { useLayoutStore } from "@/stores/layoutStore";

export default function TabActionsSheet({ session, onClose }: { session: TerminalSession; onClose: () => void }) {
  const { t } = useTranslation();
  const pinKey = `session:${session.id}`;
  const pinned = useLayoutStore((s) => s.pinnedKeys.includes(pinKey));
  const locked = session.locked === true;
  const run = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <BottomSheet title={sessionLabel(session)} onClose={onClose}>
      <SheetActionRow attr="tab-action" it={{
        icon: pinned ? "lucide:pin-off" : "lucide:pin",
        label: t(pinned ? "layout.titleBar.lock.unpinTab" : "layout.titleBar.lock.pinTab"),
        slug: pinned ? "unpin" : "pin",
        onTap: run(() => useLayoutStore.getState().setPinned(pinKey, !pinned)),
      }} />
      <SheetActionRow attr="tab-action" it={{
        icon: locked ? "lucide:lock-open" : "lucide:lock",
        label: t(locked ? "layout.titleBar.lock.unlockTab" : "layout.titleBar.lock.lockTab"),
        slug: locked ? "unlock" : "lock",
        onTap: run(() => setTabLocked({ kind: "session", id: session.id }, !locked)),
      }} />
      <SheetActionRow attr="tab-action" it={{
        icon: "lucide:x",
        label: t("layout.titleBar.closeTab"),
        slug: "close",
        danger: true,
        disabled: locked,
        disabledReason: locked ? t("layout.titleBar.lock.closeBlocked") : undefined,
        onTap: run(() => closeSessionTabs([session.id])),
      }} />
    </BottomSheet>
  );
}
