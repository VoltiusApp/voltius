import { Icon } from "@iconify/react";

interface Props {
  icon: string;
  title: string;
  description: string;
}

export default function PlaceholderPage({ icon, title, description }: Props) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-4 select-none bg-(--t-bg-base)"
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center bg-(--t-bg-elevated) border border-(--t-border)"
      >
        <Icon icon={icon} width={28} className="text-(--t-text-dim)" />
      </div>
      <div className="text-center">
        <p className="text-base font-medium-bold text-(--t-text-primary)">
          {title}
        </p>
        <p className="text-sm mt-1 text-(--t-text-dim)">
          {description}
        </p>
      </div>
    </div>
  );
}
