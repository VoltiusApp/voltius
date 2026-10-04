import { Icon } from "@iconify/react";
import { glossyTileStyle } from "@/utils/icons";

export function IconTileButton({ icon, base, title, ariaLabel, onClick }: {
  icon: string;
  base?: string;
  title: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 transition-all hover:brightness-110"
      style={glossyTileStyle(base ?? "var(--t-bg-card-avatar)")}
      title={title}
      aria-label={ariaLabel}
    >
      <Icon icon={icon} width={18} />
    </button>
  );
}
