import { Icon } from "@iconify/react";
import { VOLTIUS_PROVIDER_ID } from "@/services/syncProviders";
import type { SyncHeaderStatus } from "@/services/syncStatus";

export type SyncMenuVariant = "dropdown" | "sheet";

// Plugin providers carry their English product name; keep it out of Turkish casing.
export const providerLang = (id: string): string | undefined => (id === VOLTIUS_PROVIDER_ID ? undefined : "en");

export function SyncInlineAction({ onClick, label, slug, disabled }: { onClick: () => void; label: string; slug?: string; disabled?: boolean }) {
  return (
    <button
      data-inline-action={slug}
      disabled={disabled}
      onClick={onClick}
      className="text-[10px] font-medium transition-opacity hover:opacity-75 disabled:opacity-50 text-(--t-accent)"
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

export function SyncSectionHeader({ variant, icon, label, lang, status, children }: {
  variant: SyncMenuVariant;
  icon: string;
  label: string;
  lang?: string;
  status: SyncHeaderStatus | null;
  children?: React.ReactNode;
}) {
  const sheet = variant === "sheet";
  const color = status?.color ?? "var(--t-text-dim)";
  return (
    <div data-sync-header className={`flex items-center ${sheet ? "gap-3" : "gap-2.5"}`}>
      <span
        aria-hidden
        className={`grid place-items-center shrink-0 rounded-md ${sheet ? "size-9" : "size-7"}`}
        style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
      >
        <Icon icon={icon} width={sheet ? 18 : 14} />
      </span>
      <div className="min-w-0 flex-1">
        <div lang={lang} className={`${sheet ? "text-sm" : "text-xs"} font-semibold truncate text-(--t-text-primary)`}>{label}</div>
        {status && (
          <div className={`${sheet ? "text-xs" : "text-[10px]"} flex items-center gap-1 leading-snug`} style={{ color }}>
            {status.spin && <Icon icon="lucide:loader-circle" width={sheet ? 12 : 10} className="shrink-0 motion-safe:animate-spin" />}
            <span>{status.label}</span>
          </div>
        )}
      </div>
      {children && <div className="flex items-stretch gap-1 shrink-0">{children}</div>}
    </div>
  );
}
