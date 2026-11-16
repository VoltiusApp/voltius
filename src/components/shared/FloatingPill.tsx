import type { ReactNode } from "react";

interface FloatingPillProps {
  exiting?: boolean;
  children: ReactNode;
  testId: string;
}

// A dialog or menu on screen owns Escape; the window-level handlers must not also act on it.
export function escapeIsFree(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return false;
  const target = e.target as HTMLElement | null;
  if (target?.isContentEditable) return false;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  return !document.querySelector('[role="dialog"], [data-modal], [class*="z-100"]');
}

export function FloatingPill({ exiting = false, children, testId }: FloatingPillProps) {
  return (
    <div
      data-testid={testId}
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs shadow-lg ${exiting ? "clipboard-pill-exit" : "clipboard-pill-enter"}`}
      style={{ background: "var(--t-bg-elevated)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
    >
      {children}
    </div>
  );
}
