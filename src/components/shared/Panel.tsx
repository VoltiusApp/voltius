import { Icon } from "@iconify/react";
import type { SaveState } from "@/hooks/useAutosave";
import { useRipple } from "@/hooks/useRipple";

// ─── Shared form style constants ───────────────────────────────────────────

export const formInputClass =
  "w-full px-3 py-2 rounded-lg text-sm placeholder-text-muted focus:outline-none transition-colors";

export const formInputStyle: React.CSSProperties = {
  background: "var(--t-bg-base)",
  border: "1px solid var(--t-border)",
  color: "var(--t-text-primary)",
};

export const formLabelClass = "block text-xs font-medium mb-1.5";

export const formLabelStyle: React.CSSProperties = { color: "var(--t-text-dim)" };

// ─── Panel primitives ───────────────────────────────────────────────────────

export function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full bg-[var(--t-bg-base)] border-l border-l-[var(--t-bg-terminal)] border-t border-t-[var(--t-bg-card-hover)]">
      {children}
    </div>
  );
}

export function PanelHeaderIconButton({
  icon,
  title,
  onClick,
}: {
  icon: string;
  title: string;
  onClick: () => void;
}) {
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={createRipple}
      title={title}
      className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-[var(--t-text-dim)] relative overflow-hidden"
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--t-bg-elevated)";
        e.currentTarget.style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--t-text-dim)";
      }}
    >
      {rippleEls}
      <Icon icon={icon} width={15} />
    </button>
  );
}

const SAVE_STATE_CONFIG = {
  dirty:  { icon: "lucide:pencil",      label: "Editing...", color: "var(--t-text-dim)",    spin: false },
  saving: { icon: "lucide:loader-2",    label: "Saving...",  color: "var(--t-text-dim)",    spin: true  },
  saved:  { icon: "lucide:check-circle", label: "Saved",     color: "var(--t-accent)",      spin: false },
} as const;

function SaveStateIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const { icon, label, color, spin } = SAVE_STATE_CONFIG[state];
  return (
    <div className="flex items-center gap-1.5 select-none" style={{ color }}>
      <Icon icon={icon} width={12} className={spin ? "animate-spin" : ""} />
      <span className="text-xs">{label}</span>
    </div>
  );
}

export function PanelHeader({
  icon,
  title,
  subtitle,
  onClose,
  actions,
  saveState,
}: {
  icon: string;
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
  saveState?: SaveState;
}) {
  return (
    <div className="px-4 py-3 shrink-0 bg-[var(--t-bg-card)] border-b border-b-[var(--t-bg-terminal)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--t-bg-elevated)] border border-[var(--t-border-hover)]">
            <Icon icon={icon} width={13} className="text-[var(--t-accent)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--t-text-primary)]">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {saveState && <SaveStateIndicator state={saveState} />}
          <div className="flex items-center gap-1">
            {actions}
            <PanelHeaderIconButton icon="lucide:arrow-right-to-line" title="Close panel" onClick={onClose} />
          </div>
        </div>
      </div>
      {subtitle && (
        <div className="mt-1 ml-9">
          {subtitle}
        </div>
      )}
    </div>
  );
}

export function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)]">
      <div className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)] border-b border-b-[var(--t-bg-card-hover)]">
        {label}
      </div>
      <div className="px-4 py-3 space-y-3">{children}</div>
    </div>
  );
}
