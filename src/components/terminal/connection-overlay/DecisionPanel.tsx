import type { DecisionPanelAction, DecisionPanelProps } from "./types";

const toneClasses = {
  warning: {
    box: "bg-yellow-500/10 border-yellow-500/20",
    title: "text-yellow-400",
  },
  secure: {
    box: "bg-(--t-bg-elevated) border-(--t-border)",
    title: "text-(--t-text-primary)",
  },
};

function actionClassName(action: DecisionPanelAction): string {
  const base = "btn w-full px-4 py-2 rounded-lg text-sm disabled:cursor-not-allowed";
  if (action.variant === "ghost") {
    return `${base} btn-ghost`;
  }
  if (action.variant === "secondary") {
    return `${base} btn-secondary font-medium`;
  }
  return `${base} btn-primary font-medium`;
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
        <p className="text-(--t-text-secondary) text-xs">{description}</p>
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
