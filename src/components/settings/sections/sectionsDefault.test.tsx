import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { usePolicyStore } from "@/stores/policyStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";

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

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const NONE = { policy: {}, defaults: {} };

beforeEach(() => {
  usePolicyStore.setState({ machine: NONE, server: NONE });
  useToggleSettingsStore.setState({ values: {} });
});
afterEach(cleanup);

const SECTIONS: [string, ComponentType][] = [
  ["terminal", TerminalSection],
  ["sftp", SFTPSection],
  ["portForwarding", PortForwardingSection],
  ["hosts", HostsSection],
  ["appearance", AppearanceSection],
  ["about", AboutSection],
  ["integrations", IntegrationsSection],
  ["sync", SyncSection],
];

test.each(SECTIONS)("%s renders as before at default values", async (_name, Section) => {
  const { container } = render(<Section />);
  await act(async () => {});
  expect(container.innerHTML).toMatchSnapshot();
});
