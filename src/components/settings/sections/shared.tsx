import { Icon } from "@iconify/react";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { domainOf, isDeviceScopedDefault } from "@/services/user-data/settingKeys";
import { setKeySync } from "@/services/user-data/syncChoice";
import { useIsMobile } from "@/utils/platform";
import { ListRowContext } from "@/components/shared/listRowContext";
import { Toggle } from "@/components/shared/Toggle";
import BottomSheet from "@/components/mobile/sheets/BottomSheet";
import { SheetActionRow } from "@/components/mobile/sheets/SheetActionRow";
import RowActionsButton from "@/components/mobile/RowActionsButton";
import { useLongPress } from "@/components/mobile/useLongPress";
import { ROW_ATTR, ROW_CONTROL_ATTR } from "@/components/settings/settingsMobileCore";

/** Android: rows inside a SettingsGroup already sit in a full-bleed list. */
const InSettingsGroup = createContext(false);

/** A titled block of settings rows: the uppercase heading plus the row container. */
export function SettingsGroup({ title, divided, className, children }: {
  title: string;
  /** Draw separators between rows. */
  divided?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    // M3 list: section header + flat rows edge to edge (the page keeps 16 px gutters).
    return (
      <div className={className}>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">{title}</h3>
        <div data-settings-list className="-mx-4">
          <InSettingsGroup.Provider value={true}>{children}</InSettingsGroup.Provider>
        </div>
      </div>
    );
  }
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
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <MobileSettingRow title={title} desc={desc} dirty={dirty} onReset={onReset} dimmed={dimmed} truncateDesc={truncateDesc} syncKey={syncKey}>
        {children}
      </MobileSettingRow>
    );
  }
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
  const isMobile = useIsMobile();

  if (isMobile) {
    // M3 list row: leading icon, title + supporting text, full bleed.
    return (
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        data-settings-action
        className="-mx-4 w-[calc(100%+2rem)] flex items-center gap-4 px-4 py-3 min-h-14 text-left disabled:opacity-50"
      >
        <Icon icon={icon} width={22} className="shrink-0" style={{ color: danger ? "var(--t-status-error)" : "var(--t-accent)" }} />
        <span className="flex-1 min-w-0">
          <span className="block text-base" style={{ color: danger && !disabled ? "var(--t-status-error)" : color }}>{label}</span>
          <span className="block text-sm mt-0.5 text-(--t-text-dim)">{sub}</span>
        </span>
      </button>
    );
  }

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
  const isMobile = useIsMobile();
  if (isMobile) {
    // Touch has no hover: a visible M3 text button, shown only while the value is off its default.
    return (
      <button
        type="button"
        data-setting-reset
        onClick={onReset}
        aria-label={t("settings.shared.resetToDefault")}
        className="shrink-0 h-10 px-3 rounded-full text-sm font-medium text-(--t-accent)"
      >
        {t("settings.shared.reset")}
      </button>
    );
  }
  return (
    <button
      onClick={onReset}
      className="p-1 rounded-sm transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-(--t-text-muted)"
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
      title={t("settings.shared.resetToDefault")}
    >
      <Icon icon="lucide:rotate-ccw" width={11} />
    </button>
  );
}

/** Per-setting cloud sync state, shared by the desktop cloud button and the Android row sheet. */
function useKeySync(path: string) {
  const domainSynced = useSyncPrefsStore((s) => s.isDomainSynced(domainOf(path)));
  const synced = useSyncPrefsStore((s) => s.isSettingSynced(path));
  const deviceDefault = useSyncPrefsStore((s) => isDeviceScopedDefault(path, s.settingSyncOverrides ?? {}));
  return { domainSynced, synced, deviceDefault };
}

export function SyncKeyButton({ path }: { path: string }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { domainSynced, synced, deviceDefault } = useKeySync(path);

  const title = !domainSynced
    ? t("settings.sync.keyButton.domainOff")
    : synced
      ? t("settings.sync.keyButton.hold")
      : deviceDefault
        ? t("settings.sync.keyButton.deviceDefault")
        : t("settings.sync.keyButton.resume");

  // Muted once the domain itself is off: without this, a domain-off row is
  // visually indistinguishable from a setting the user held back individually.
  const accented = domainSynced && !synced && !deviceDefault;

  return (
    <button
      data-testid="sync-key-button"
      data-sync-key={path}
      disabled={!domainSynced}
      onClick={() => setKeySync(path, !synced)}
      title={title}
      aria-label={title}
      className={isMobile
        // Touch: always visible, with a 40 dp target.
        ? "p-2.5 -m-1.5 rounded-full text-(--t-text-muted)"
        : `p-1 rounded-sm transition-opacity text-(--t-text-muted)${synced ? " opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""}`}
      style={{ color: accented ? "var(--t-accent)" : undefined }}
      onMouseEnter={(e) => { if (domainSynced) e.currentTarget.style.color = "var(--t-text-bright)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = accented ? "var(--t-accent)" : ""; }}
    >
      <Icon icon={synced ? "lucide:cloud" : "lucide:cloud-off"} width={isMobile ? 16 : 11} />
    </button>
  );
}

/**
 * Android settings row (M3 list item): title + supporting text, the control trailing,
 * 56 dp min (72 with two lines). A tap on the text runs the control (MobileSettings
 * forwards it, see rowTapControl). Reset is a visible text button while the value is
 * off its default; a long-press opens the row's actions (reset, per-setting sync).
 */
function MobileSettingRow({ title, desc, dirty, onReset, dimmed, truncateDesc, syncKey, children }: {
  title: ReactNode;
  desc?: ReactNode;
  dirty?: boolean;
  onReset?: () => void;
  dimmed?: boolean;
  truncateDesc?: boolean;
  syncKey?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const inGroup = useContext(InSettingsGroup);
  const [sheet, setSheet] = useState(false);
  const canReset = !!(dirty && onReset);
  const hasActions = canReset || !!syncKey;
  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu, onClick } = useLongPress(() => setSheet(true));
  const ref = useRef<HTMLDivElement>(null);
  // Rows whose tap does something get the B5 ripple; a row holding only a text field doesn't.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.querySelector(`[${ROW_CONTROL_ATTR}]`)) el.setAttribute("data-ripple", "");
    else el.removeAttribute("data-ripple");
  });
  const style = dimmed ? { opacity: 0.45 } : undefined;
  const name = typeof title === "string" ? title : undefined;
  const press = hasActions ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu, onClick } : {};

  return (
    <>
    <div
      ref={ref}
      {...{ [ROW_ATTR]: "" }}
      className={`relative flex items-center gap-4 min-h-14 py-3 px-4${inGroup ? "" : " -mx-4"}`}
      {...press}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-base text-(--t-text-primary)" style={style}>
          <span className="min-w-0">{title}</span>
          {dirty && <DirtyDot />}
          {syncKey && <HeldBackMark path={syncKey} />}
        </div>
        {desc !== undefined && (
          <div className={`text-sm mt-0.5 text-(--t-text-dim)${truncateDesc ? " truncate" : ""}`} style={style}>
            {desc}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <ListRowContext.Provider value={true}>
          {canReset && <ResetButton onReset={onReset!} />}
          {children}
        </ListRowContext.Provider>
      </div>
      {hasActions && (
        <RowActionsButton
          attr="data-setting-actions"
          value={syncKey ?? name ?? ""}
          label={t("settings.shared.rowActions")}
          name={name ?? ""}
          onTap={() => setSheet(true)}
        />
      )}
    </div>
    {/* Outside the row: touches in the sheet must not reach the row's long-press. */}
    {sheet && (
        <BottomSheet title={name} onClose={() => setSheet(false)}>
          {canReset && (
            <SheetActionRow
              attr="setting-action"
              it={{ icon: "lucide:rotate-ccw", label: t("settings.shared.resetToDefault"), slug: "reset", onTap: () => { onReset!(); setSheet(false); } }}
            />
          )}
          {syncKey && <SyncSheetRow path={syncKey} />}
        </BottomSheet>
    )}
    </>
  );
}

/** Status only, not a button: the setting is held back from cloud sync. */
function HeldBackMark({ path }: { path: string }) {
  const { t } = useTranslation();
  const { domainSynced, synced } = useKeySync(path);
  if (synced || !domainSynced) return null;
  return <Icon icon="lucide:cloud-off" width={14} className="shrink-0 text-(--t-text-dim)" aria-label={t("settings.shared.sync.off")} />;
}

/** "Sync this setting" switch inside the Android row actions sheet. */
function SyncSheetRow({ path }: { path: string }) {
  const { t } = useTranslation();
  const { domainSynced, synced, deviceDefault } = useKeySync(path);
  const sub = !domainSynced
    ? t("settings.sync.keyButton.domainOff")
    : synced
      ? t("settings.shared.sync.on")
      : deviceDefault
        ? t("settings.shared.sync.deviceDefault")
        : t("settings.shared.sync.off");
  return (
    <div {...{ [ROW_ATTR]: "" }} data-ripple data-setting-sync={path} className="relative flex items-center gap-3 px-3 py-3 rounded-xl">
      <Icon icon={synced ? "lucide:cloud" : "lucide:cloud-off"} width={18} className="shrink-0 text-(--t-text-primary)" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.shared.sync.label")}</p>
        <p className="text-xs mt-0.5 text-(--t-text-dim)">{sub}</p>
      </div>
      <Toggle checked={synced} disabled={!domainSynced} onChange={(v) => setKeySync(path, v)} aria-label={t("settings.shared.sync.label")} />
    </div>
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
