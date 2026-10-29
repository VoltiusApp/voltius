import { Icon } from "@iconify/react";
import { VOLTIUS_PROVIDER_ID } from "@/services/syncProviders";

export type SyncMenuVariant = "dropdown" | "sheet";

// Plugin providers carry their English product name; keep it out of Turkish casing.
export const providerLang = (id: string): string | undefined => (id === VOLTIUS_PROVIDER_ID ? undefined : "en");

export function SyncSectionTitle({ icon, label, lang, variant }: {
  icon: string;
  label: string;
  lang?: string;
  variant: SyncMenuVariant;
}) {
  const sheet = variant === "sheet";
  return (
    <div className="flex items-center gap-1.5 text-(--t-text-dim)">
      <Icon icon={icon} width={sheet ? 13 : 12} />
      <span lang={lang} className={`${sheet ? "text-[11px]" : "text-[10px]"} font-bold uppercase tracking-widest`}>
        {label}
      </span>
    </div>
  );
}

export function SyncInlineAction({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] font-medium transition-opacity hover:opacity-75 text-(--t-accent)"
    >
      {label}
    </button>
  );
}

export function SyncHeaderButton({ onClick, title, disabled = false, faded = false, children }: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  faded?: boolean;
  children: React.ReactNode;
}) {
  const rest = disabled ? "var(--t-text-dim)" : "var(--t-text-secondary)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-medium transition-all"
      style={{ color: rest, background: "var(--t-bg-elevated)", opacity: faded ? 0.4 : 1 }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = rest;
      }}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}
