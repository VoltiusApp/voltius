import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { ActiveTunnel, Connection, TerminalSession } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/hooks/useRuleTunnels", () => ({
  useRuleTunnels: () => ({ statusFor: () => ({ status: "idle", statusLabel: "", isBusy: false }), startRule: vi.fn(), stopRule: vi.fn() }),
}));

const host = { id: "c1", name: "db-1", host: "db-01", port: 22, username: "root", connection_type: "ssh" } as unknown as Connection;
const session = { id: "s1", connectionId: "c1", connectionName: "db-1", status: "connected", type: "ssh" } as TerminalSession;
const tunnel = {
  id: "t1", tunnel_type: "local", local_port: 5236, remote_port: 5236, remote_host: "127.0.0.1",
  bind_host: "127.0.0.1", target_host: null, origin: { type: "auto" }, state: "active", bytes_transferred: 0, remote_listening: true,
} as unknown as ActiveTunnel;
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [host] }));
vi.mock("@/hooks/usePfStates", () => ({
  useConnectedSshPfStates: () => ({ sessions: [session], pfStates: new Map([["s1", { tunnels: [tunnel], suppressed_ports: [] }]]) }),
}));

import MobilePortForwardingScreen from "./MobilePortForwardingScreen";
import { PreviewContentScope } from "@/components/preview/PreviewScope";
import { startPreview, stopPreview } from "@/test/preview";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { initialMobileNavState } from "@/stores/mobileNavCore";

beforeEach(() => useMobileNavStore.setState({ ...initialMobileNavState, hostSearch: "" }));
afterEach(() => {
  cleanup();
  stopPreview();
});

const section = () => document.querySelector("[data-pf-active-section]");

test("active_tunnels_are_hidden_while_previewing_and_shown_outside", async () => {
  startPreview();
  render(<PreviewContentScope><MobilePortForwardingScreen /></PreviewContentScope>);
  await act(async () => {});
  expect(section()).toBeNull();
  cleanup();
  stopPreview();
  render(<PreviewContentScope><MobilePortForwardingScreen /></PreviewContentScope>);
  await act(async () => {});
  expect(section()).not.toBeNull();
});
