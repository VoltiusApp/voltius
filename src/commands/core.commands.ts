import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { checkForUpdate } from "@/services/updater";
import { closeSessionTabs } from "@/services/closeSession";
import { activeTabTarget, isPinnedKey, isSessionLocked, setTabLocked, tabTargetKey, tabTargetLocked } from "@/services/tabLock";
import { useLayoutStore } from "@/stores/layoutStore";
import { defineCommand, navCommand, pendingActionCommand } from "./defineCommand";
import i18n, { lazyT } from "@/i18n";
import { PORT_FORWARDING_ICON } from "@/lib/conceptIcons";

const noActiveTab = () =>
  activeTabTarget() ? undefined : { message: i18n.t("omni.commands.noActiveTab"), proceed: false };

const activePinKey = () => {
  const target = activeTabTarget();
  return target ? tabTargetKey(target) : null;
};

const openSessions = () =>
  useSessionStore.getState().sessions.filter((s) => s.status === "connected" || s.status === "connecting");

export const commands: OmniCommand[] = [
  pendingActionCommand({
    id: "core:new-host",
    label: lazyT("omni.commands.newHost"),
    icon: "lucide:server",
    keywords: ["add", "create", "ssh", "connection", "server"],
    setter: "setHomePendingAction",
    action: { action: "create" },
    nav: "hosts",
  }),
  pendingActionCommand({
    id: "core:new-key",
    label: lazyT("omni.commands.newKey"),
    icon: "lucide:key-round",
    keywords: ["add", "create", "key", "keychain", "ssh", "rsa", "ed25519"],
    setter: "setKeychainPendingAction",
    action: { action: "create-key" },
    nav: "keychain",
  }),
  pendingActionCommand({
    id: "core:new-identity",
    label: lazyT("omni.commands.newIdentity"),
    icon: "lucide:id-card",
    keywords: ["add", "create", "identity", "credential", "user"],
    setter: "setKeychainPendingAction",
    action: { action: "create-identity" },
    nav: "keychain",
  }),
  defineCommand({
    id: "core:settings",
    label: lazyT("omni.commands.settings"),
    icon: "lucide:settings",
    keywords: ["preferences", "config", "options", "appearance", "theme"],
    execute: () => useUIStore.getState().openSettings(),
  }),
  defineCommand({
    id: "core:check-for-update",
    label: lazyT("omni.commands.checkForUpdate"),
    icon: "lucide:refresh-cw",
    keywords: ["update", "version", "upgrade", "release", "changelog"],
    execute: () => {
      checkForUpdate().catch(() => {});
      useUIStore.getState().openSettings("about");
    },
  }),
  defineCommand({
    id: "core:whats-new",
    label: lazyT("omni.commands.whatsNew"),
    icon: "lucide:megaphone",
    keywords: ["changelog", "release", "notes", "news", "update", "version"],
    execute: () => useUIStore.getState().openWhatsNew(),
  }),
  navCommand({
    id: "core:port-forwarding",
    label: lazyT("omni.commands.portForwarding"),
    icon: PORT_FORWARDING_ICON,
    keywords: ["tunnel", "forward", "port", "proxy"],
    nav: "port-forwarding",
  }),
  navCommand({
    id: "core:known-hosts",
    label: lazyT("omni.commands.knownHosts"),
    icon: "lucide:shield-check",
    keywords: ["known", "hosts", "fingerprint", "trust", "security"],
    nav: "known-hosts",
  }),
  navCommand({
    id: "core:logs",
    label: lazyT("omni.commands.logs"),
    icon: "lucide:scroll-text",
    keywords: ["log", "debug", "console", "output", "trace"],
    nav: "logs",
  }),
  pendingActionCommand({
    id: "core:new-snippet",
    label: lazyT("omni.commands.newSnippet"),
    icon: "lucide:braces",
    keywords: ["add", "create", "snippet", "command", "text", "macro"],
    setter: "setSnippetsPendingAction",
    action: { action: "create" },
    nav: "snippets",
  }),
  defineCommand({
    id: "core:team-members",
    label: lazyT("omni.commands.teamMembers"),
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
    label: lazyT("omni.commands.disconnectAll"),
    icon: "lucide:unplug",
    keywords: ["close", "end", "stop", "quit", "sessions", "all", "kill"],
    guard: () => {
      const open = openSessions();
      const locked = open.filter((s) => isSessionLocked(s.id)).length;
      const count = open.length - locked;
      if (open.length === 0) return { message: i18n.t("omni.commands.disconnectAllNone"), proceed: false };
      if (count === 0) return { message: i18n.t("omni.commands.disconnectAllLocked", { count: locked }), proceed: false };
      if (locked === 0) return { message: i18n.t("omni.commands.disconnectAllConfirm", { count }), proceed: true };
      const kept = i18n.t("omni.commands.disconnectAllKept", { count: locked });
      return { message: i18n.t("omni.commands.disconnectAllConfirmKept", { count, kept }), proceed: true };
    },
    execute: () => {
      closeSessionTabs(openSessions().map((s) => s.id), { reportKept: true });
    },
  }),
  defineCommand({
    id: "core:toggle-tab-lock",
    label: () => {
      const target = activeTabTarget();
      return i18n.t(target && tabTargetLocked(target) ? "omni.commands.unlockTab" : "omni.commands.lockTab");
    },
    icon: "lucide:lock",
    keywords: ["lock", "unlock", "protect", "close", "tab", "pane"],
    guard: noActiveTab,
    execute: () => {
      const target = activeTabTarget();
      if (target) setTabLocked(target, !tabTargetLocked(target));
    },
  }),
  defineCommand({
    id: "core:toggle-tab-pin",
    label: () => {
      const key = activePinKey();
      return i18n.t(key && isPinnedKey(key) ? "omni.commands.unpinTab" : "omni.commands.pinTab");
    },
    icon: "lucide:pin",
    keywords: ["pin", "unpin", "tab", "first", "keep"],
    guard: noActiveTab,
    execute: () => {
      const key = activePinKey();
      if (key) useLayoutStore.getState().setPinned(key, !isPinnedKey(key));
    },
  }),
];
