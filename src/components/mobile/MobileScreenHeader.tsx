import { Icon } from "@iconify/react";
import type { ReactNode } from "react";

/**
 * Title bar of a full-screen mobile plugin screen: back arrow, title with an
 * optional second line, and a right-hand slot for the screen's own controls.
 * Exported on `@voltius/ui` — every mobile plugin screen carried a copy.
 */
export function MobileScreenHeader({ title, subtitle, onBack, children }: {
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  children?: ReactNode;
}) {
  return (
    <header
      className="shrink-0 flex items-center gap-2 px-2 h-12 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
    >
      <button data-mobile-back onClick={onBack} className="p-2 text-(--t-text-primary)">
        <Icon icon="lucide:arrow-left" width={22} />
      </button>
      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-base font-semibold text-(--t-text-primary) leading-tight truncate">{title}</span>
        {subtitle && (
          <span className="text-[11px] text-(--t-text-dim) leading-tight truncate">{subtitle}</span>
        )}
      </span>
      {children}
    </header>
  );
}
