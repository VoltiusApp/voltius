import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
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

export default function MobileSelectionBar({ attr, count, allSelected, onClose, onToggleAll, actions }: {
  attr: string;
  count: number;
  allSelected: boolean;
  onClose: () => void;
  onToggleAll: () => void;
  actions: BarAction[];
}) {
  const { t } = useTranslation();
  const base = attr.replace(/-selection-bar$/, "-sel");
  return (
    <header {...{ [`data-${attr}`]: "" }} className="shrink-0 flex items-center h-12 pr-1 border-b"
      style={{ background: "color-mix(in srgb, var(--t-accent) 16%, var(--t-bg-chrome))", borderColor: "var(--t-border)" }}>
      <BarButton action={{ attr: `data-${base}-clear`, icon: "lucide:x", label: t("mobile.selection.clearSelectionAriaLabel"), onTap: onClose }} />
      <span {...{ [`data-${base}-count`]: "" }} className="flex-1 min-w-0 truncate text-base font-medium text-(--t-text-primary) tabular-nums">
        {t("mobile.selection.selectedCount", { count })}
      </span>
      <BarButton pressed={allSelected}
        action={{ attr: `data-${base}-all`, icon: allSelected ? "lucide:list-x" : "lucide:list-checks", label: t("mobile.selection.selectAll"), onTap: onToggleAll }} />
      {actions.map((a) => <BarButton key={a.attr} action={a} />)}
    </header>
  );
}
