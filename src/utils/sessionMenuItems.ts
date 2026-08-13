import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { canDuplicateSession, duplicateSession } from "@/services/duplicateSession";
import { useSessionStore } from "@/stores/sessionStore";
import { getShortcutHint } from "@/stores/shortcutStore";
import type { TerminalSession } from "@/types";

/** Entries shared by the tab context menu and the pane header menu, close last. */
export function sessionMenuItems({
  session,
  t,
  closeLabel,
  onClose,
  extras = [],
}: {
  session: TerminalSession;
  t: TFunction;
  closeLabel: string;
  onClose: () => void;
  /** Caller-specific entries, inserted between reconnect and close. */
  extras?: ContextMenuItem[];
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (canDuplicateSession(session)) {
    items.push(
      {
        label: t("panes.header.duplicate"),
        icon: "lucide:copy-plus",
        shortcut: getShortcutHint("duplicate-session"),
        onClick: () => { duplicateSession(session.id, "tab"); },
      },
      {
        label: t("panes.header.duplicateSplit"),
        icon: "lucide:columns-2",
        shortcut: getShortcutHint("duplicate-session-split"),
        onClick: () => { duplicateSession(session.id, "right"); },
      },
    );
  }

  items.push(
    { label: t("panes.header.reconnect"), icon: "lucide:rotate-cw", onClick: () => void useSessionStore.getState().reconnect(session.id) },
    ...extras,
    { label: closeLabel, icon: "lucide:x", danger: true, onClick: onClose },
  );

  return items;
}
