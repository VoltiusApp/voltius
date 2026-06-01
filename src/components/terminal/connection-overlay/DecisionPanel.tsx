import type { DecisionPanelAction, DecisionPanelProps } from "./types";

const toneClasses = {
  warning: {
    box: "bg-yellow-500/10 border-yellow-500/20",
    title: "text-yellow-400",
  },
  secure: {
    box: "bg-[var(--t-bg-elevated)] border-[var(--t-border)]",
    title: "text-[var(--t-text-primary)]",
  },
};

function actionClassName(action: DecisionPanelAction): string {
  const base = "w-full px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  if (action.variant === "ghost") {
    return `${base} text-text-muted hover:text-text-primary`;
  }
  if (action.variant === "secondary") {
    return `${base} font-medium bg-[var(--t-bg-elevated)] text-text-primary border border-[var(--t-border)] hover:bg-[var(--t-bg-card-hover)]`;
  }
  return `${base} font-medium bg-accent text-white hover:bg-accent/80`;
}

export function DecisionPanel({
  tone,
  icon,
  title,
  description,
  children,
  actions,
}: DecisionPanelProps) {
  const classes = toneClasses[tone];

  return (
    <div className="w-full flex flex-col gap-4">
      <div className={`w-full p-3 rounded-lg border text-left ${classes.box}`}>
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className={`text-xs font-semibold tracking-wide ${classes.title}`}>{title}</span>
        </div>
        <p className="text-[var(--t-text-secondary)] text-xs">{description}</p>
      </div>

      {children}

      <div className="w-full flex flex-col gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
            className={actionClassName(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
