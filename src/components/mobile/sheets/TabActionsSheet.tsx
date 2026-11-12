import { useTranslation } from "react-i18next";
import type { TerminalSession } from "@/types";
import BottomSheet from "./BottomSheet";
import { SheetActionRow } from "./SheetActionRow";
import { sessionLabel } from "@/utils/sessionLabel";
import { closeSessionTabs } from "@/services/closeSession";
import { tabFlagActions } from "@/utils/tabFlagMenuItems";

export default function TabActionsSheet({ session, onClose }: { session: TerminalSession; onClose: () => void }) {
  const { t } = useTranslation();
  const locked = session.locked === true;
  const run = (fn: () => void) => () => { fn(); onClose(); };
  const flags = tabFlagActions(t, { pinKey: `session:${session.id}`, lockTarget: { kind: "session", id: session.id }, locked, scope: "tab" });

  return (
    <BottomSheet title={sessionLabel(session)} onClose={onClose}>
      {flags.map((flag) => (
        <SheetActionRow key={flag.id} attr="tab-action" it={{ icon: flag.icon, label: flag.label, slug: flag.id, onTap: run(flag.run) }} />
      ))}
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
