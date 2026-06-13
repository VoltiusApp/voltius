import { Icon } from "@iconify/react";
import { useMobileNavStore } from "@/stores/mobileNavStore";

/** Titled header for full-screen pushed panel pages: back chevron + panel name + session name. */
export default function MobilePanelHeader({ title, sessionName, right, onBack }: {
  title: string;
  sessionName?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  const pop = useMobileNavStore((s) => s.pop);
  return (
    <header className="shrink-0 flex items-center gap-2 px-2 h-12 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}>
      <button data-mobile-back onClick={onBack ?? pop} className="p-2 text-(--t-text-primary)">
        <Icon icon="lucide:arrow-left" width={22} />
      </button>
      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-base font-semibold text-(--t-text-primary) leading-tight truncate">{title}</span>
        {sessionName && <span className="text-[11px] text-(--t-text-dim) leading-tight truncate">{sessionName}</span>}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </header>
  );
}
