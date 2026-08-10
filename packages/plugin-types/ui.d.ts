// Components the host exposes to plugins. Externalized at build time so you use
// the host's own instances — see the build script in package.json.
declare module "@voltius/ui" {
  import type { ComponentType, ReactNode } from "react";
  import type { PluginAPI, PluginSession } from "@voltius/plugin-types";
  export const Icon: ComponentType<{ icon: string; width?: number | string; className?: string }>;
  export const InfoTooltip: ComponentType<{ text: string; children?: ReactNode }>;
  export const BottomSheet: ComponentType<{ title?: string; onClose: () => void; children?: ReactNode }>;
  export const MobileScreenHeader: ComponentType<{
    title: string;
    subtitle?: string | null;
    onBack: () => void;
    children?: ReactNode;
  }>;
  export function useAutosave<T>(value: T, save: (v: T) => void | Promise<void>, delayMs?: number): void;
  export function useT(api: PluginAPI): PluginAPI["i18n"]["t"];
  export function useSessionById(api: PluginAPI, sessionId: string): PluginSession | null;
  export function useActiveSession(api: PluginAPI | null): PluginSession | null;
  export const ConnectionAvatar: ComponentType<{
    connection: {
      connection_type?: "ssh" | "serial" | "ftp";
      serial_port?: string;
      icon?: string;
      distro?: string;
    };
    size: number;
  }>;
  export const ConfirmModal: ComponentType<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>;
}
