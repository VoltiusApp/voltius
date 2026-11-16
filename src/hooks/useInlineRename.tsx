import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { InlineNameEditor } from "@/components/shared/InlineNameEditor";
import { getShortcutHint } from "@/stores/shortcutStore";
import { whenWritable } from "@/services/previewGuard";

const RENAME_ITEM_EVENT = "voltius:rename-item";

export function requestRename(id: string) {
  window.dispatchEvent(new CustomEvent<string>(RENAME_ITEM_EVENT, { detail: id }));
}

export function useInlineRename(id: string, enabled: boolean, name: string, onRename: (name: string) => void) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const startRename = useMemo(() => whenWritable(() => setRenaming(true)), []);

  useEffect(() => {
    if (!enabled) return;
    const onRequest = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) startRename();
    };
    window.addEventListener(RENAME_ITEM_EVENT, onRequest);
    return () => window.removeEventListener(RENAME_ITEM_EVENT, onRequest);
  }, [id, enabled, startRename]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setRenaming(false);
  };

  const editor = renaming && enabled
    ? <InlineNameEditor value={name} onCommit={commit} onCancel={() => setRenaming(false)} maxLength={255} className="w-full bg-transparent outline-hidden" />
    : null;
  const menuItems = useMemo<ContextMenuItem[]>(() => enabled
    ? [{ label: t("common.action.rename"), icon: "lucide:text-cursor-input", onClick: startRename, shortcut: getShortcutHint("rename") }]
    : [], [enabled, t, startRename]);

  return { editor, menuItems };
}
