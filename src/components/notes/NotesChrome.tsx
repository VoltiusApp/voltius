import type { ReactNode } from "react";
import { Icon } from "@iconify/react";

export const NOTES_ICON_BUTTON = "rounded-sm text-(--t-text-muted) hover:text-(--t-text-primary) hover:bg-(--t-bg-elevated)";

export function NotesFrame({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`rounded-lg border border-(--t-border) overflow-hidden bg-(--t-bg-card) ${className}`}>{children}</div>;
}

export function NotesEmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
      <Icon icon="lucide:notebook-pen" width={20} className="text-(--t-text-muted)" />
      <p className="text-xs text-(--t-text-secondary)">{message}</p>
      {children}
    </div>
  );
}
