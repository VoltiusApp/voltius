import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { usePolicyStore } from "@/stores/policyStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useThemeStore } from "@/stores/themeStore";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { settingDef } from "@/components/settings/registry/entries";
import { effectiveDefault, resetSetting } from "@/components/settings/registry/defaults";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), startDragging: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k), i18n: { language: "en" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("/logo.svg?react", () => ({ default: () => <svg data-logo /> }));
vi.mock("@/services/vault", () => ({ getSecret: vi.fn(async () => null), storeSecret: vi.fn(), deleteSecret: vi.fn() }));

import TerminalSection from "./TerminalSection";
import SFTPSection from "./SFTPSection";
import PortForwardingSection from "./PortForwardingSection";
import HostsSection from "./HostsSection";
import AppearanceSection from "./AppearanceSection";
import AboutSection from "./AboutSection";
import IntegrationsSection from "./IntegrationsSection";
import SyncSection from "./SyncSection";
import { SessionSecuritySettings } from "./SessionSecuritySettings";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const NONE = { policy: {}, defaults: {} };
const DOT = '[title="settings.shared.modifiedFromDefault"]';

beforeEach(() => {
  usePolicyStore.setState({ machine: NONE, server: NONE });
  useToggleSettingsStore.setState({ values: {} });
});
afterEach(cleanup);

const OTHER: Record<string, unknown> = {
  "terminal.scrollbackLines": 100_000,
  "terminal.cursorStyle": "block",
  "sftp.autoRefreshIntervalMs": 5_000,
  "hosts.pollIntervalMs": 120_000,
  "hosts.activePollIntervalMs": 10_000,
  "connectivity.keepalivePreset": "fast",
  "connectivity.proxy": { mode: "system" },
  "connectivity.detachedTtlHours": "72",
  "appearance.uiScale": 1.25,
  "appearance.terminalFontSize": 18,
  "locale.language": "fr",
  "locale.timeFormat": "24h",
  "theme.mode": "system",
  "theme.lightThemeId": "voltius",
  "theme.darkThemeId": "voltius-light",
  "theme.activeThemeId": "voltius-light",
  "security.sessionTimeoutMinutes": 15,
  "security.lockAction": "screen",
};

const ROWS: [string, ComponentType, string[]][] = [
  ["terminal", TerminalSection, [
    "terminal.scrollbackLines", "terminal.cursorStyle", "toggles.cursor-blink", "toggles.scroll-minimap",
    "toggles.select-to-copy", "toggles.drag-selects-text", "toggles.ignore-bracketed-paste",
    "toggles.paste-image-as-path", "toggles.command-history", "toggles.keyword-highlight",
  ]],
  ["sftp", SFTPSection, ["toggles.sftp-tar", "toggles.sftp-autorefresh", "sftp.autoRefreshIntervalMs", "sftp.editorAutoSave"]],
  ["portForwarding", PortForwardingSection, ["toggles.auto-forward", "toggles.forwarding-notifications"]],
  ["hosts", HostsSection, [
    "toggles.reachability", "hosts.pollIntervalMs", "hosts.activePollIntervalMs", "connectivity.keepalivePreset",
    "connectivity.proxy", "toggles.persistent-sessions", "toggles.detached-session-ttl", "connectivity.detachedTtlHours",
    "toggles.shell-integration", "toggles.team-presence",
  ]],
  ["appearance", AppearanceSection, [
    "appearance.uiScale", "appearance.terminalFontSize", "locale.language", "locale.timeFormat",
    "toggles.group-tabs-by-host", "theme.mode", "theme.lightThemeId", "theme.darkThemeId", "theme.activeThemeId",
  ]],
  ["about", AboutSection, ["updater.autoUpdate", "toggles.changelog-popup"]],
  ["integrations", IntegrationsSection, ["toggles.mcp-server"]],
  ["sync", SyncSection, ["sync.type.connection", "sync.domain.themes"]],
  ["session security", () => <SessionSecuritySettings mode="local" />, ["security.sessionTimeoutMinutes", "security.lockAction"]],
];

const CASES = ROWS.flatMap(([name, Section, keys]) => keys.map((key) => [name, key, Section] as const));

function changeAway(key: string) {
  const def = settingDef(key)!;
  const next = key in OTHER ? OTHER[key] : !effectiveDefault(def);
  if (key === "connectivity.proxy") useConnectivitySettingsStore.getState().setProxy(next as never);
  else def.set!(next);
}

test.each(CASES)("%s: %s shows the changed dot off default", async (_name, key, Section) => {
  const def = settingDef(key)!;
  if (key === "hosts.pollIntervalMs" || key === "hosts.activePollIntervalMs") useToggleSettingsStore.getState().set("reachability", true);
  if (key === "theme.lightThemeId" || key === "theme.darkThemeId") useThemeStore.setState({ mode: "system" });
  changeAway(key);
  try {
    const { container } = render(<Section />);
    await act(async () => {});
    const title = def.titleKey ?? def.labelKey;
    const labels = [...container.querySelectorAll("*")].filter((el) => el.textContent === title && ![...el.children].some((c) => c.textContent === title));
    expect(labels.length, `${key}: no element titled ${title}`).toBeGreaterThan(0);
    const withDot = labels.some((el) => {
      for (let n: Element | null = el, i = 0; n && i < 5; n = n.parentElement, i++) if (n.querySelector(DOT)) return true;
      return false;
    });
    expect(withDot, `${key}: no changed dot near ${title}`).toBe(true);
  } finally {
    resetSetting(def);
    useThemeStore.setState({ mode: "manual" });
  }
});
