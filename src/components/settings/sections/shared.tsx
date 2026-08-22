import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { domainOf, settingKey } from "@/services/user-data/settingKeys";
import { setKeySync } from "@/services/user-data/syncChoice";

/** A titled block of settings rows: the uppercase heading plus the row container. */
export function SettingsGroup({ title, divided, className, children }: {
  title: string;
  /** Draw separators between rows. */
  divided?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
        {title}
      </h3>
      <div
        className={`rounded-lg bg-(--t-bg-elevated) border border-(--t-border)${divided ? " divide-y divide-(--t-border)" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One setting: label and description on the left, the control on the right,
 * preceded by the reset affordances whenever the value is off its default.
 *
 * `list` rows sit inside a `SettingsGroup` container; `card` rows are their own
 * bordered card and stand alone.
 */
export function SettingRow({ title, desc, dirty, onReset, dimmed, truncateDesc, syncKey, variant = "list", className, children }: {
  title: ReactNode;
  desc?: ReactNode;
  dirty?: boolean;
  onReset?: () => void;
  /** Fades the label and description, for a row its parent toggle has disabled. */
  dimmed?: boolean;
  /** Clips an overlong description (a path, say) instead of widening the row. */
  truncateDesc?: boolean;
  /** Dotted key from SETTING_KEYS: adds the per-setting cloud-sync control. */
  syncKey?: string;
  variant?: "list" | "card";
  className?: string;
  children: ReactNode;
}) {
  const card = variant === "card";
  const base = card
    ? "group rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4"
    : "group flex items-center justify-between px-4 py-3 gap-4";
  const style = dimmed ? { opacity: 0.45 } : undefined;

  return (
    <div className={className ? `${base} ${className}` : base}>
      <div className={truncateDesc ? "min-w-0" : undefined}>
        <div className="text-sm font-medium text-(--t-text-primary)" style={style}>
          {title}
        </div>
        {desc !== undefined && (
          <div
            className={`${card ? "text-xs mt-1" : "text-xs mt-0.5"} text-(--t-text-dim)${truncateDesc ? " truncate" : ""}`}
            style={style}
          >
            {desc}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {syncKey && <SyncKeyButton path={syncKey} />}
        {dirty && onReset && <ResetButton onReset={onReset} />}
        {dirty && <DirtyDot />}
        {children}
      </div>
    </div>
  );
}

export function ActionItem({ icon, label, sub, danger, disabled, onClick }: {
  icon: string;
  label: string;
  sub: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const color = disabled ? "var(--t-text-dim)" : danger ? "var(--t-text-muted)" : "var(--t-text-primary)";

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="w-full flex items-start gap-3 px-4 py-3 rounded-lg text-left transition-colors bg-(--t-bg-elevated) border border-(--t-border) hover:bg-(--t-bg-card-hover)"
      style={{
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && danger) {
          (e.currentTarget as HTMLButtonElement).style.borderColor =
            "color-mix(in srgb, var(--t-status-error) 55%, transparent)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "";
      }}
    >
      <Icon
        icon={icon}
        width={16}
        className="shrink-0"
        style={{ color: danger ? "var(--t-status-error)" : "var(--t-accent)", marginTop: 2 }}
      />
      <div>
        <p className="text-sm font-medium" style={{ color }}>{label}</p>
        <p className="text-xs mt-0.5 text-(--t-text-dim)">{sub}</p>
      </div>
    </button>
  );
}

export function SettingsInput({ type = "text", placeholder, value, onChange, autoFocus, "aria-label": ariaLabel }: {
  type?: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  "aria-label"?: string;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
    />
  );
}

export function DirtyDot() {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden
      title={t("settings.shared.modifiedFromDefault")}
      className="inline-block shrink-0 rounded-full"
      style={{ width: 5, height: 5, background: "var(--t-accent)" }}
    />
  );
}

export function ResetButton({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onReset}
      className="p-1 rounded-sm transition-opacity opacity-0 group-hover:opacity-100 text-(--t-text-muted)"
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
      title={t("settings.shared.resetToDefault")}
    >
      <Icon icon="lucide:rotate-ccw" width={11} />
    </button>
  );
}

export function SyncKeyButton({ path }: { path: string }) {
  const { t } = useTranslation();
  const domainSynced = useSyncPrefsStore((s) => s.isDomainSynced(domainOf(path)));
  const synced = useSyncPrefsStore((s) => s.isSettingSynced(path));
  const explicit = useSyncPrefsStore((s) => s.settingSyncOverrides[path] !== undefined);
  const deviceDefault = !explicit && !!settingKey(path)?.deviceScoped;

  const title = !domainSynced
    ? t("settings.sync.keyButton.domainOff")
    : synced
      ? t("settings.sync.keyButton.hold")
      : deviceDefault
        ? t("settings.sync.keyButton.deviceDefault")
        : t("settings.sync.keyButton.resume");

  return (
    <button
      data-testid="sync-key-button"
      data-sync-key={path}
      disabled={!domainSynced}
      onClick={() => setKeySync(path, !synced)}
      title={title}
      aria-label={title}
      className={`p-1 rounded-sm transition-opacity text-(--t-text-muted)${synced ? " opacity-0 group-hover:opacity-100" : ""}`}
      style={{ color: !synced && !deviceDefault ? "var(--t-accent)" : undefined }}
      onMouseEnter={(e) => { if (domainSynced) e.currentTarget.style.color = "var(--t-text-bright)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = !synced && !deviceDefault ? "var(--t-accent)" : ""; }}
    >
      <Icon icon={synced ? "lucide:cloud" : "lucide:cloud-off"} width={11} />
    </button>
  );
}

export function FormButtons({ onCancel, submitLabel, submitting }: {
  onCancel: () => void;
  submitLabel: string;
  /** Dims and disables submit while the request is in flight. */
  submitting?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="btn btn-secondary flex-1 py-1.5 rounded-lg text-sm"
      >
        {t("settings.shared.cancel")}
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="btn btn-primary flex-1 py-1.5 rounded-lg text-sm font-medium"
        style={submitting === undefined ? undefined : { opacity: submitting ? 0.7 : 1 }}
      >
        {submitLabel}
      </button>
    </div>
  );
}

/**
 * Centered modal card used by the settings dialogs: scrim that closes on an
 * outside click, and a header with the title and a close button.
 */
export function SettingsDialog({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-xl p-5 shadow-2xl bg-(--t-bg-terminal) border border-(--t-border)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-(--t-text-primary)">{title}</h2>
          <button
            onClick={onClose}
            className="text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
          >
            <Icon icon="lucide:x" width={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
