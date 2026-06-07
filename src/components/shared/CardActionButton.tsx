import { Icon } from "@iconify/react";

interface Props {
  icon: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
  /** When true (default) the button is hidden until the card is hovered. */
  reveal?: boolean;
  width?: number;
}

export function CardActionButton({ icon, title, onClick, danger, reveal = true, width = 18 }: Props) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`${reveal ? "hidden group-hover:flex" : "flex"} items-center justify-center p-1.5 rounded-lg transition-colors text-(--t-text-secondary)`}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = danger ? "var(--t-status-error)" : "var(--t-text-primary)";
        e.currentTarget.style.background = danger
          ? "color-mix(in srgb, var(--t-status-error) 18%, transparent)"
          : "color-mix(in srgb, #ffffff 10%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--t-text-secondary)";
        e.currentTarget.style.background = "transparent";
      }}
      title={title}
    >
      <Icon icon={icon} width={width} />
    </button>
  );
}
