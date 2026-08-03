// Components the host exposes to plugins. Externalized at build time so you use
// the host's own instances — see the build script in package.json.
declare module "@voltius/ui" {
  import type { ComponentType, ReactNode } from "react";
  export const Icon: ComponentType<{ icon: string; width?: number | string; className?: string }>;
  export const InfoTooltip: ComponentType<{ text: string; children?: ReactNode }>;
  export const BottomSheet: ComponentType<{ title?: string; onClose: () => void; children?: ReactNode }>;
  export function useAutosave<T>(value: T, save: (v: T) => void | Promise<void>, delayMs?: number): void;
}
