import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { checkForUpdate } from "@/services/updater";

export const commands: OmniCommand[] = [
  {
    id: "core:local-terminal",
    label: "Local Terminal",
    icon: "lucide:terminal",
    keywords: ["shell", "bash", "zsh", "local", "console"],
    section: "Actions",
    execute: () => {
      const { connectLocal } = useSessionStore.getState();
      const { setSidebarOpen, setActiveNav } = useUIStore.getState();
      connectLocal().catch(() => {});
      setSidebarOpen(false);
      setActiveNav("terminal" as any);
    },
  },
  {
    id: "core:new-host",
    label: "New Host",
    icon: "lucide:server",
    keywords: ["add", "create", "ssh", "connection", "server"],
    section: "Actions",
    execute: () => {
      const { setHomePendingAction, setActiveNav } = useUIStore.getState();
      setHomePendingAction({ action: "create" });
      setActiveNav("hosts" as any);
    },
  },
  {
    id: "core:new-key",
    label: "New SSH Key",
    icon: "lucide:key-round",
    keywords: ["add", "create", "key", "keychain", "ssh", "rsa", "ed25519"],
    section: "Actions",
    execute: () => {
      const { setKeychainPendingAction, setActiveNav } = useUIStore.getState();
      setKeychainPendingAction({ action: "create-key" });
      setActiveNav("keychain" as any);
    },
  },
  {
    id: "core:new-identity",
    label: "New Identity",
    icon: "lucide:id-card",
    keywords: ["add", "create", "identity", "credential", "user"],
    section: "Actions",
    execute: () => {
      const { setKeychainPendingAction, setActiveNav } = useUIStore.getState();
      setKeychainPendingAction({ action: "create-identity" });
      setActiveNav("keychain" as any);
    },
  },
  {
    id: "core:keyboard-shortcuts",
    label: "Keyboard Shortcuts",
    icon: "lucide:keyboard",
    keywords: ["keybind", "hotkey", "shortcut", "rebind"],
    section: "Actions",
    shortcutId: "shortcuts",
    execute: () => useUIStore.getState().setShortcutsOpen(true),
  },
  {
    id: "core:check-for-update",
    label: "Check for Update",
    icon: "lucide:refresh-cw",
    keywords: ["update", "version", "upgrade", "release", "changelog"],
    section: "Actions",
    execute: () => {
      checkForUpdate().catch(() => {});
      useUIStore.getState().openSettings("about");
    },
  },
  {
    id: "core:port-forwarding",
    label: "Port Forwarding",
    icon: "lucide:arrow-left-right",
    keywords: ["tunnel", "forward", "port", "proxy"],
    section: "Actions",
    execute: () => useUIStore.getState().setActiveNav("port-forwarding" as any),
  },
  {
    id: "core:known-hosts",
    label: "Known Hosts",
    icon: "lucide:shield-check",
    keywords: ["known", "hosts", "fingerprint", "trust", "security"],
    section: "Actions",
    execute: () => useUIStore.getState().setActiveNav("known-hosts" as any),
  },
  {
    id: "core:logs",
    label: "Logs",
    icon: "lucide:scroll-text",
    keywords: ["log", "debug", "console", "output", "trace"],
    section: "Actions",
    execute: () => useUIStore.getState().setActiveNav("logs" as any),
  },
];
