import { Icon } from "@iconify/react";
import { useTerminalPanelItems } from "./terminalPanelItems";

/** Toggleable quick-access row of terminal panels (mirrors the ⋮ menu). */
export default function MobileTerminalPanelsRow() {
  const items = useTerminalPanelItems();
  return (
    <div data-mobile-panels-row className="shrink-0 flex items-center gap-1 overflow-x-auto px-1.5 h-12 border-t"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}>
      {items.map((it) => (
        <button key={it.key} data-mobile-panel-quick={it.key} onClick={it.onTap}
          className="vt-hit shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "var(--t-bg-card)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)" }}>
          <Icon icon={it.icon} width={15} />{it.label}
        </button>
      ))}
    </div>
  );
}
