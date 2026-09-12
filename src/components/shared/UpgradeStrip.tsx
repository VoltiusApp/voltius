export type UpgradeStripVariant = "accent" | "neutral";

const BUTTON_CLASS: Record<UpgradeStripVariant, string> = {
  accent: "bg-(--t-accent) text-white",
  neutral: "bg-(--t-bg-elevated) text-(--t-text-primary) border border-(--t-border)",
};

export function UpgradeStrip({
  label,
  buttonLabel,
  onClick,
  variant = "accent",
}: {
  label: string;
  buttonLabel: string;
  onClick: () => void;
  variant?: UpgradeStripVariant;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 bg-(--t-bg-input)">
      <p className="text-xs text-(--t-text-muted)">{label}</p>
      <button
        onClick={onClick}
        className={`text-xs px-2.5 py-1 rounded-md font-medium shrink-0 hover:opacity-85 transition-opacity ${BUTTON_CLASS[variant]}`}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
