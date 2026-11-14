import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";

export const STRIP_SURFACE = "var(--t-bg-status-bar)";
// Plain accent drops to 3.4:1 on Voltius Light's status bar; this mix clears 4.5:1 in every built-in theme.
const ACTION_TEXT = "color-mix(in srgb, var(--t-accent) 70%, var(--t-text-bright))";

/** A desktop toast: a slim band in the status bar's material, one width for the whole stack. */
export function ToastStrip({ leaving, progress, children }: { leaving: boolean; progress?: number; children: ReactNode }) {
  return (
    <div
      className={`group relative flex flex-col gap-1 pl-3 pr-1 py-1 text-[13px] overflow-hidden pointer-events-auto ${leaving ? "animate-toast-drop" : "animate-toast-rise"}`}
      style={{
        width: "30rem",
        maxWidth: "calc(100vw - 1.5rem)",
        minHeight: "2rem",
        justifyContent: "center",
        background: STRIP_SURFACE,
        borderRadius: 6,
        boxShadow: "var(--t-ring-strong), var(--t-elev-1)",
      }}
    >
      {children}
      {progress !== undefined && (
        <span
          className="absolute left-0 bottom-0 h-px transition-[width] duration-300"
          style={{ width: `${progress}%`, background: "var(--t-accent)" }}
        />
      )}
    </div>
  );
}

export function StripTextButton({ label, onClick, disabled = false, tone = "accent" }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "accent" | "muted";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 px-2 h-6 rounded-[6px] text-[12.5px] font-medium transition-colors hover:bg-(--t-bg-elevated) disabled:opacity-50 disabled:pointer-events-none"
      style={{ color: tone === "accent" ? ACTION_TEXT : "var(--t-text-muted)" }}
    >
      {label}
    </button>
  );
}

export function StripDismissButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      aria-label={t("common.action.dismiss")}
      title={t("common.action.dismiss")}
      className="size-6 grid place-items-center rounded-[6px] shrink-0 text-(--t-text-dim) opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-(--t-bg-elevated) hover:text-(--t-text-muted) transition-opacity"
    >
      <Icon icon="lucide:x" width={12} />
    </button>
  );
}
