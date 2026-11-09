import type { ReactNode } from "react";
import { Icon } from "@iconify/react";

export interface CardAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  loading?: boolean;
}

export function Heading({ title, body }: { title: string; body: ReactNode }) {
  return (
    <>
      <p className="text-sm mb-1.5 text-center font-medium text-(--t-text-bright) break-words">{title}</p>
      <p className="text-xs mb-4 text-center leading-relaxed text-(--t-text-secondary) break-words">{body}</p>
    </>
  );
}

export function StateCard({ icon, color, title, body, actions, children }: {
  icon: string;
  color: string;
  title: string;
  body: ReactNode;
  actions: CardAction[];
  children?: ReactNode;
}) {
  return (
    <div className="w-full">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mx-auto mb-3"
        style={{
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        }}
      >
        <Icon icon={icon} width={20} style={{ color }} />
      </div>
      <Heading title={title} body={body} />
      {children}
      <div className="space-y-2">
        {actions.map(({ label, onClick, primary = true, loading }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            disabled={loading}
            className={`btn ${primary ? "btn-primary" : "btn-secondary"} w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2`}
          >
            {loading && <Icon icon="lucide:loader-circle" width={14} className="animate-spin" />}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
