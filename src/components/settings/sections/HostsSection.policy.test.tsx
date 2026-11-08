import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_GLOBAL_PROXY, useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { usePolicyStore } from "@/stores/policyStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/vault", () => ({ getSecret: vi.fn(async () => null), storeSecret: vi.fn(), deleteSecret: vi.fn() }));

import HostsSection from "./HostsSection";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const NONE = { policy: {}, defaults: {} };
const policy = (p: Record<string, unknown>) => usePolicyStore.setState({ machine: { policy: p, defaults: {} }, server: NONE });
const isDisabled = (el: Element) => el.matches(":disabled");

beforeEach(() => {
  usePolicyStore.setState({ machine: NONE, server: NONE });
  useToggleSettingsStore.setState({ values: {} });
  useConnectivitySettingsStore.setState({ proxy: DEFAULT_GLOBAL_PROXY, detachedTtlHours: 24 });
});
afterEach(cleanup);

test("TTL options above the range are disabled", () => {
  policy({ "appSettings.detachedTtlHours": { $range: { max: 24 } } });
  render(<HostsSection />);
  expect(screen.getByText(/common\.policy\.rangeMax/)).toBeTruthy();
  expect(screen.getByText("common.policy.managed")).toBeTruthy();
  const row = screen.getByText("settings.hosts.detachedTtl.durationTitle").closest(".group") as HTMLElement;
  fireEvent.click(row.querySelector("[data-form-select]")!);
  const option = (label: string) => screen.getAllByText(label).slice(-1)[0].closest("button")!;
  expect(isDisabled(option('settings.hosts.detachedTtl.hours {"count":24}'))).toBe(false);
  expect(isDisabled(option('settings.hosts.detachedTtl.days {"count":3}'))).toBe(true);
  expect(isDisabled(option('settings.hosts.detachedTtl.days {"count":7}'))).toBe(true);
});

test("proxy lock disables mode, host and port but not username", () => {
  policy({ "appSettings.proxy": { mode: "socks5", host: "corp.proxy", port: 3128 } });
  render(<HostsSection />);
  const host = screen.getByLabelText("connections.form.proxy.host") as HTMLInputElement;
  expect(host.value).toBe("corp.proxy");
  expect(isDisabled(host)).toBe(true);
  expect(isDisabled(screen.getByLabelText("connections.form.proxy.port"))).toBe(true);
  expect(isDisabled(screen.getByLabelText("connections.form.proxy.label"))).toBe(true);
  expect(isDisabled(screen.getByLabelText("connections.form.proxy.username"))).toBe(false);
  expect(isDisabled(screen.getByLabelText("connections.form.proxy.password"))).toBe(false);
  expect(screen.getAllByText("common.policy.managed").length).toBeGreaterThan(0);
});
