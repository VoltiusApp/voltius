import { Icon } from "@iconify/react";

const SIZES = {
  page: { wrap: "h-full min-h-[320px] gap-5", tile: "w-16 h-16 rounded-2xl", icon: 28, button: "px-4 py-2 text-sm", plus: 14 },
  section: { wrap: "py-12 gap-3", tile: "w-12 h-12 rounded-xl", icon: 20, button: "px-3 py-1.5 text-xs", plus: 12 },
};

export function EmptyState({ icon, title, body, action, size = "page" }: {
  icon: string;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void; icon?: string };
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  return (
    <div className={`col-span-full flex flex-col items-center justify-center text-center ${s.wrap}`}>
      <div className={`flex items-center justify-center bg-(--t-bg-toolbar) border border-(--t-border) ${s.tile}`}>
        <Icon icon={icon} width={s.icon} className="text-(--t-text-dim)" />
      </div>
      <div>
        <p className="text-sm font-medium text-(--t-text-primary)">{title}</p>
        {body && <p className="text-xs mt-1 max-w-[22rem] text-(--t-text-dim)">{body}</p>}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className={`flex items-center gap-2 rounded-lg font-medium transition-colors bg-(--t-bg-elevated) hover:bg-(--t-border-hover) text-(--t-accent) border border-(--t-border-hover) ${s.button}`}
        >
          <Icon icon={action.icon ?? "lucide:plus"} width={s.plus} />
          {action.label}
        </button>
      )}
    </div>
  );
}
