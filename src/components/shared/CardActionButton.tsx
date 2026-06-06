import { Icon } from "@iconify/react";

interface Props {
  icon: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
}

export function CardActionButton({ icon, title, onClick, danger }: Props) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="p-1.5 hidden group-hover:flex rounded-lg transition-colors text-(--t-text-secondary)"
      onMouseEnter={(e) => (e.currentTarget.style.color = danger ? "var(--t-status-error)" : "var(--t-text-primary)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-secondary)")}
      title={title}
    >
      <Icon icon={icon} width={18} />
    </button>
  );
}
