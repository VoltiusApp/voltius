import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { checkForUpdate } from "@/services/updater";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { defineCommand, navCommand, pendingActionCommand } from "./defineCommand";

export const commands: OmniCommand[] = [
  defineCommand({
    id: "core:local-terminal",
    label: "Local Terminal",
    icon: "lucide:terminal",
    keywords: ["shell", "bash", "zsh", "local", "console"],
    execute: () => {
      const { connectLocal } = useSessionStore.getState();
      const { setSidebarOpen, setActiveNav } = useUIStore.getState();
      connectLocal().catch(() => {});
      setSidebarOpen(false);
      setActiveNav("terminal");
    },
  }),
  pendingActionCommand({
    id: "core:new-host",
    label: "New Host",
    icon: "lucide:server",
    keywords: ["add", "create", "ssh", "connection", "server"],
    setter: "setHomePendingAction",
    action: { action: "create" },
    nav: "hosts",
  }),
  pendingActionCommand({
    id: "core:new-key",
    label: "New SSH Key",
    icon: "lucide:key-round",
    keywords: ["add", "create", "key", "keychain", "ssh", "rsa", "ed25519"],
    setter: "setKeychainPendingAction",
    action: { action: "create-key" },
    nav: "keychain",
  }),
  pendingActionCommand({
    id: "core:new-identity",
    label: "New Identity",
    icon: "lucide:id-card",
    keywords: ["add", "create", "identity", "credential", "user"],
    setter: "setKeychainPendingAction",
    action: { action: "create-identity" },
    nav: "keychain",
  }),
  defineCommand({
    id: "core:settings",
    label: "Settings",
    icon: "lucide:settings",
    keywords: ["preferences", "config", "options", "appearance", "theme"],
    execute: () => useUIStore.getState().openSettings(),
  }),
  defineCommand({
    id: "core:check-for-update",
    label: "Check for Update",
    icon: "lucide:refresh-cw",
    keywords: ["update", "version", "upgrade", "release", "changelog"],
    execute: () => {
      checkForUpdate().catch(() => {});
      useUIStore.getState().openSettings("about");
    },
  }),
  defineCommand({
    id: "core:whats-new",
    label: "What's New",
    icon: "lucide:megaphone",
    keywords: ["changelog", "release", "notes", "news", "update", "version"],
    execute: () => useUIStore.getState().openWhatsNew(),
  }),
  navCommand({
    id: "core:port-forwarding",
    label: "Port Forwarding",
    icon: "lucide:arrow-left-right",
    keywords: ["tunnel", "forward", "port", "proxy"],
    nav: "port-forwarding",
  }),
  navCommand({
    id: "core:known-hosts",
    label: "Known Hosts",
    icon: "lucide:shield-check",
    keywords: ["known", "hosts", "fingerprint", "trust", "security"],
    nav: "known-hosts",
  }),
  navCommand({
    id: "core:logs",
    label: "Logs",
    icon: "lucide:scroll-text",
    keywords: ["log", "debug", "console", "output", "trace"],
    nav: "logs",
  }),
  pendingActionCommand({
    id: "core:new-snippet",
    label: "New Snippet",
    icon: "lucide:braces",
    keywords: ["add", "create", "snippet", "command", "text", "macro"],
    setter: "setSnippetsPendingAction",
    action: { action: "create" },
    nav: "snippets",
  }),
  defineCommand({
    id: "core:team-members",
    label: "Team Members",
    icon: "lucide:users",
    keywords: ["team", "members", "people", "invite", "manage", "roles"],
    execute: () => {
      const { setActiveNav, setHomeView } = useUIStore.getState();
      setActiveNav("members");
      setHomeView(false);
    },
  }),
  defineCommand({
    id: "core:disconnect-all",
    label: "Disconnect All",
    icon: "lucide:unplug",
    keywords: ["close", "end", "stop", "quit", "sessions", "all", "kill"],
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
  }),
];
