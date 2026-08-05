import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { getShortcutHint } from "@/stores/shortcutStore";

/**
 * Cut/Copy for a single-item context menu. The card selects itself on
 * right-click, so the page hook's `getSelection()` already holds this item by
 * the time either fires. Kept ungated to match the bulk menu: paste-time
 * pre-flight is what actually refuses a move the vault does not allow.
 */
export function clipboardMenuItems(t: TFunction): ContextMenuItem[] {
  return [
    {
      label: t("common.action.cut"),
      icon: "lucide:scissors",
      shortcut: getShortcutHint("cut"),
      onClick: () => window.dispatchEvent(new CustomEvent("voltius:clipboard-cut")),
      divider: true,
    },
    {
      label: t("common.action.copy"),
      icon: "lucide:copy",
      shortcut: getShortcutHint("copy"),
      onClick: () => window.dispatchEvent(new CustomEvent("voltius:clipboard-copy")),
    },
  ];
}
