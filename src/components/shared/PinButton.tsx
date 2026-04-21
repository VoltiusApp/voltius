import { Icon } from "@iconify/react";

interface Props {
  pinned: boolean;
  onToggle: () => void;
  size?: number;
}

export function PinButton({ pinned, onToggle, size = 15 }: Props) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={pinned ? "Unpin" : "Pin"}
      className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
      style={{ color: pinned ? "var(--t-accent)" : "var(--t-text-dim)" }}
      onMouseEnter={(e) => { if (!pinned) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
      onMouseLeave={(e) => { if (!pinned) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
    >
      <Icon icon={pinned ? "lucide:pin" : "lucide:pin-off"} width={size} />
    </button>
  );
}
