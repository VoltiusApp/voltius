import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { touchHeight } from "@/components/mobile/touch";

const LOOKS = {
  plain: { button: "focus-ring flex items-center gap-1 w-full text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)", icon: 12, iconClass: undefined },
  compact: { button: "flex items-center gap-1 text-[11px] text-(--t-text-secondary)", icon: 11, iconClass: undefined },
  row: { button: "w-full flex items-center gap-1.5 px-3 py-2 text-xs text-(--t-text-secondary)", icon: 12, iconClass: "text-(--t-text-dim)" },
};

export function DisclosureToggle({ open, onToggle, label, align = "center", look = "plain" }: {
  open: boolean; onToggle: () => void; label: ReactNode; align?: "center" | "start"; look?: keyof typeof LOOKS;
}) {
  const { button, icon, iconClass } = LOOKS[look];
  const alignClass = look !== "plain" ? "" : align === "center" ? "justify-center" : "text-left";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={[button, alignClass, touchHeight()].filter(Boolean).join(" ")}
    >
      <Icon icon={open ? "lucide:chevron-down" : "lucide:chevron-right"} width={icon} className={iconClass} />
      {label}
    </button>
  );
}
