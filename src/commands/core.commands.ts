import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { checkForUpdate } from "@/services/updater";
import { useTeamSessionStore } from "@/stores/teamSessionStore";

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
    id: "core:settings",
    label: "Settings",
    icon: "lucide:settings",
    keywords: ["preferences", "config", "options", "appearance", "theme"],
    section: "Actions",
    execute: () => useUIStore.getState().openSettings(),
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
  {
    id: "core:new-snippet",
    label: "New Snippet",
    icon: "lucide:braces",
    keywords: ["add", "create", "snippet", "command", "text", "macro"],
    section: "Actions",
    execute: () => {
      const { setActiveNav, setSnippetsPendingAction } = useUIStore.getState();
      setSnippetsPendingAction({ action: "create" });
      setActiveNav("snippets" as any);
    },
  },
  {
    id: "core:team-members",
    label: "Team Members",
    icon: "lucide:users",
    keywords: ["team", "members", "people", "invite", "manage", "roles"],
    section: "Actions",
    execute: () => {
      const { setActiveNav, setHomeView } = useUIStore.getState();
      setActiveNav("members" as any);
      setHomeView(false);
    },
  },
  {
    id: "core:disconnect-all",
    label: "Disconnect All",
    icon: "lucide:unplug",
    keywords: ["close", "end", "stop", "quit", "sessions", "all", "kill"],
    section: "Actions",
    execute: () => {
      const { sessions, disconnect, removeSession } = useSessionStore.getState();
      const mpStore = useTeamSessionStore.getState();
      sessions
        .filter((s) => s.status === "connected" || s.status === "connecting")
        .forEach((s) => {
          const mpConn = mpStore.connections[s.id];
          if (mpConn) {
            if (mpConn.role === "host") {
              mpStore.stopSharing(s.id).catch(() => {});
            } else {
              mpStore.leaveSession(s.id);
            }
            removeSession(s.id);
          } else {
            disconnect(s.id).catch(() => {});
          }
        });
    },
  },
];
