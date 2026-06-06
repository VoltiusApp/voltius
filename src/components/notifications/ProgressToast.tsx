import { Icon } from "@iconify/react";
import type { ToastEntry } from "@/stores/notificationStore";

interface Props {
  toast: ToastEntry;
  onDismiss: () => void;
  pluginUnloaded: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: "var(--t-accent)",
  success: "var(--t-status-connected)",
  warning: "var(--t-status-warning)",
  error: "var(--t-status-error)",
};

export function ProgressToast({ toast, onDismiss, pluginUnloaded }: Props) {
  const isFinished = toast.finished;
  const displaySeverity = isFinished ? (toast.finishedSeverity ?? "success") : toast.severity;
  const borderColor = SEVERITY_COLORS[displaySeverity] ?? SEVERITY_COLORS.info;

  return (
    <div
      className="pointer-events-auto flex flex-col gap-1.5 px-3 py-2.5 rounded-xl shadow-lg text-sm animate-fadeIn"
      style={{
        minWidth: "16rem",
        maxWidth: "24rem",
        background: "var(--t-bg-card)",
        border: `1px solid var(--t-border)`,
        borderLeft: `2px solid ${borderColor}`,
      }}
    >
      <div className="flex items-center gap-2">
        {isFinished ? (
          <Icon
            icon={displaySeverity === "error" ? "lucide:x-circle" : "lucide:check-circle"}
            width={14}
            style={{ color: borderColor, flexShrink: 0 }}
          />
        ) : (
          <Icon
            icon="lucide:loader-circle"
            width={14}
            className="animate-spin"
            style={{ color: "var(--t-text-muted)", flexShrink: 0 }}
          />
        )}
        <span
          className="text-xs shrink-0"
          style={{ color: "var(--t-text-dim)" }}
          title={toast.pluginName}
        >
          [{toast.pluginName.slice(0, 20)}]
        </span>
        <span className="flex-1 text-(--t-text-primary) font-medium truncate">{toast.message}</span>
        {(isFinished || toast.cancellable) && (
          <button
            onClick={onDismiss}
            disabled={pluginUnloaded && !isFinished}
            className="w-4 h-4 flex items-center justify-center rounded-sm shrink-0 transition-colors"
            style={{ color: "var(--t-text-dim)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
          >
            <Icon icon="lucide:x" width={11} />
          </button>
        )}
      </div>

      {!isFinished && (
        <div className="flex items-center gap-2">
          {toast.progress !== undefined ? (
            <>
              <div
                className="flex-1 h-1 rounded-full overflow-hidden"
                style={{ background: "var(--t-bg-elevated)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${toast.progress}%`, background: borderColor }}
                />
              </div>
              <span className="text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>
                {Math.round(toast.progress)}%
              </span>
            </>
          ) : (
            <div className="flex-1" />
          )}
          {toast.cancellable && !isFinished && (
            <button
              onClick={onDismiss}
              disabled={pluginUnloaded}
              className="text-xs px-1.5 py-0.5 rounded-sm transition-colors"
              style={{
                color: "var(--t-text-muted)",
                opacity: pluginUnloaded ? 0.5 : 1,
                pointerEvents: pluginUnloaded ? "none" : "auto",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
