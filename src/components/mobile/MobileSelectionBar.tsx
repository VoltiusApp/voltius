import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./sheets/BottomSheet";
import { tapOrExplain } from "./tapOrExplain";

export interface BarAction {
  attr: string;
  icon: string;
  label: string;
  onTap: () => void;
  danger?: boolean;
  disabledReason?: string | null;
}

function BarButton({ action, pressed }: { action: BarAction; pressed?: boolean }) {
  const { attr, icon, label, onTap, danger, disabledReason } = action;
  return (
    <button {...{ [attr]: "" }} onClick={tapOrExplain(disabledReason, onTap)} aria-label={disabledReason ?? label} title={disabledReason ?? label}
      aria-pressed={pressed} aria-disabled={!!disabledReason || undefined}
      className="w-12 h-12 shrink-0 flex items-center justify-center rounded-full aria-disabled:opacity-35"
      style={{ color: danger ? "var(--t-status-error)" : "var(--t-text-primary)" }}>
      <Icon icon={icon} width={20} />
    </button>
  );
}

export default function MobileSelectionBar({ attr, count, allSelected, onClose, onToggleAll, actions, more }: {
  attr: string;
  count: number;
  allSelected: boolean;
  onClose: () => void;
  onToggleAll: () => void;
  actions: BarAction[];
  more?: BarAction[];
}) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const base = attr.replace(/-selection-bar$/, "-sel");
  const countLabel = t("mobile.selection.selectedCount", { count });
  return (
    <>
      <header {...{ [`data-${attr}`]: "" }} className="shrink-0 flex items-center h-12 pr-1 border-b"
        style={{ background: "color-mix(in srgb, var(--t-accent) 16%, var(--t-bg-chrome))", borderColor: "var(--t-border)" }}>
        <BarButton action={{ attr: `data-${base}-clear`, icon: "lucide:x", label: t("mobile.selection.clearSelectionAriaLabel"), onTap: onClose }} />
        <span {...{ [`data-${base}-count`]: "" }} className="flex-1 min-w-0 truncate text-base font-medium text-(--t-text-primary) tabular-nums">
          {countLabel}
        </span>
        <BarButton pressed={allSelected}
          action={{ attr: `data-${base}-all`, icon: allSelected ? "lucide:list-x" : "lucide:list-checks", label: t("mobile.selection.selectAll"), onTap: onToggleAll }} />
        {actions.map((a) => <BarButton key={a.attr} action={a} />)}
        {more && more.length > 0 && (
          <BarButton action={{ attr: `data-${base}-more`, icon: "lucide:ellipsis-vertical", label: t("mobile.selection.moreActions"), onTap: () => setMoreOpen(true) }} />
        )}
      </header>
      {moreOpen && more && (
        <BottomSheet title={countLabel} onClose={() => setMoreOpen(false)}>
          {more.map((a) => (
            <button key={a.attr} {...{ [a.attr]: "" }} aria-disabled={!!a.disabledReason || undefined} title={a.disabledReason ?? undefined}
              onClick={tapOrExplain(a.disabledReason, () => { setMoreOpen(false); a.onTap(); })}
              className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card) aria-disabled:opacity-35"
              style={{ color: a.danger ? "var(--t-status-error)" : "var(--t-text-primary)" }}>
              <Icon icon={a.icon} width={18} /><span className="text-sm font-medium">{a.label}</span>
            </button>
          ))}
        </BottomSheet>
      )}
    </>
  );
}
