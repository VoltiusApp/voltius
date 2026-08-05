import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { NavItem } from "@/stores/uiStore";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { getShortcutHint } from "@/stores/shortcutStore";

const EXIT_MS = 140;

export function ClipboardPill({ navItem }: { navItem: NavItem }) {
  const { t } = useTranslation();
  const clipboard = useVaultClipboardStore((s) => s.clipboard);
  const mine = clipboard && clipboard.tab === navItem ? clipboard : null;

  // Held one render past clearing so the exit animation can run.
  const [visible, setVisible] = useState(mine);
  const [exiting, setExiting] = useState(false);
  const countRef = useRef(0);

  useEffect(() => {
    if (mine) { setVisible(mine); setExiting(false); return; }
    if (!visible) return;
    setExiting(true);
    const timer = setTimeout(() => { setVisible(null); setExiting(false); }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [mine, visible]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useVaultClipboardStore.getState().clipboard) {
        useVaultClipboardStore.getState().clear();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  if (!visible) return null;

  const count = visible.items.length + visible.folderIds.length;
  const isCut = visible.mode === "cut";
  const popped = count !== countRef.current;
  countRef.current = count;

  return (
    <div
      data-testid="clipboard-pill"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-full border text-xs shadow-lg ${exiting ? "clipboard-pill-exit" : "clipboard-pill-enter"}`}
      style={{ background: "var(--t-bg-elevated)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
    >
      <Icon icon={isCut ? "lucide:scissors" : "lucide:copy"} width={14} />
      <span className={popped ? "clipboard-count-pop" : undefined}>
        {isCut ? t("common.clipboard.cut", { count }) : t("common.clipboard.copied", { count })}
      </span>
      <span style={{ color: "var(--t-text-dim)" }}>
        {isCut
          ? t("common.clipboard.toMove", { shortcut: getShortcutHint("paste") ?? "Ctrl+V" })
          : t("common.clipboard.toPaste", { shortcut: getShortcutHint("paste") ?? "Ctrl+V" })}
      </span>
      <button
        data-testid="clipboard-pill-clear"
        title={t("common.clipboard.clear")}
        onClick={() => useVaultClipboardStore.getState().clear()}
        className="ml-1 w-5 h-5 flex items-center justify-center rounded-full"
        style={{ color: "var(--t-text-muted)" }}
      >
        <Icon icon="lucide:x" width={12} />
      </button>
    </div>
  );
}
