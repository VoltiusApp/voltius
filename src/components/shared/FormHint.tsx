import type { ReactNode } from "react";

export function FormHint({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`${className} text-xs text-(--t-text-dim)`.trim()}>{children}</p>;
}
