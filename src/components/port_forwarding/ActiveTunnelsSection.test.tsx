import { test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ActiveTunnel, Connection, TerminalSession } from "@/types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const h = vi.hoisted(() => ({ session: null as unknown as TerminalSession, tunnels: [] as ActiveTunnel[] }));
const host = { id: "c1", name: "web-1", host: "web-01", port: 2222, username: "root", connection_type: "ssh" } as unknown as Connection;

vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [host] }));
vi.mock("@/hooks/usePfStates", () => ({
  useConnectedSshPfStates: () => ({ sessions: [h.session], pfStates: new Map([["s1", { tunnels: h.tunnels, suppressed_ports: [8080] }]]) }),
}));

import { ActiveTunnelsSection } from "./ActiveTunnelsSection";
import { useUIStore } from "@/stores/uiStore";

afterEach(() => {
  cleanup();
  h.tunnels = [];
  useUIStore.setState({ activeTunnelsCollapsed: false });
});

const sessionOf = (extra: Partial<TerminalSession>) =>
  ({ id: "s1", connectionId: "c1", connectionName: "web-1", status: "connected", type: "ssh", ...extra }) as TerminalSession;

test("the card shows the user the session connected as", () => {
  h.session = sessionOf({ connectedUsername: "alice" });
  render(<ActiveTunnelsSection />);
  expect(screen.getByText("alice@web-01:2222")).toBeTruthy();
});

test("without a recorded user it shows the host's, as before", () => {
  h.session = sessionOf({});
  render(<ActiveTunnelsSection />);
  expect(screen.getByText("root@web-01:2222")).toBeTruthy();
});

test("the section header folds the forwards away and keeps the totals in view", () => {
  h.session = sessionOf({});
  render(<ActiveTunnelsSection />);
  const header = screen.getByText("portForwarding.activeTunnels.sectionTitle");
  fireEvent.click(header);
  expect(screen.queryByText("root@web-01:2222")).toBeNull();
  expect(screen.getByText("portForwarding.activeTunnels.tunnelCount")).toBeTruthy();
  expect(useUIStore.getState().activeTunnelsCollapsed).toBe(true);

  fireEvent.click(header);
  expect(screen.getByText("root@web-01:2222")).toBeTruthy();
});

test("a folded section stays folded the next time the page opens", () => {
  h.session = sessionOf({});
  useUIStore.setState({ activeTunnelsCollapsed: true });
  render(<ActiveTunnelsSection />);
  expect(screen.queryByText("root@web-01:2222")).toBeNull();
});

test("a folded section still says a forward failed", () => {
  h.session = sessionOf({});
  h.tunnels = [{ id: "t1", remote_port: 5432, local_port: 5432, origin: { type: "auto" }, state: { error: "address in use" } } as ActiveTunnel];
  useUIStore.setState({ activeTunnelsCollapsed: true });
  render(<ActiveTunnelsSection />);
  expect(screen.queryByText("address in use")).toBeNull();
  expect(screen.getByText("portForwarding.activeTunnels.errorCount")).toBeTruthy();
});

test("a section with no failed forward shows no error count", () => {
  h.session = sessionOf({});
  useUIStore.setState({ activeTunnelsCollapsed: true });
  render(<ActiveTunnelsSection />);
  expect(screen.queryByText("portForwarding.activeTunnels.errorCount")).toBeNull();
});
