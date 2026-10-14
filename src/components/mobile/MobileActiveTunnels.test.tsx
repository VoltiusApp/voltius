import { test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ActiveTunnel, Connection, TerminalSession } from "@/types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, o?: { port?: number }) => (o?.port ? `${key}:${o.port}` : key) }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const h = vi.hoisted(() => ({ tunnels: [] as ActiveTunnel[], suppressed: [] as number[] }));
const pf = vi.hoisted(() => ({ closePfTunnel: vi.fn(async () => {}), resumeAutoPort: vi.fn(async () => ({})) }));
const host = { id: "c1", name: "db-1", host: "db-01", port: 22, username: "root", connection_type: "ssh" } as unknown as Connection;
const session = { id: "s1", connectionId: "c1", connectionName: "db-1", status: "connected", type: "ssh" } as TerminalSession;

vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [host] }));
vi.mock("@/hooks/usePfStates", () => ({
  useConnectedSshPfStates: () => ({ sessions: [session], pfStates: new Map([["s1", { tunnels: h.tunnels, suppressed_ports: h.suppressed }]]) }),
}));
vi.mock("@/services/portForwardingTunnels", () => pf);

import MobileActiveTunnels from "./MobileActiveTunnels";

afterEach(() => {
  cleanup();
  h.tunnels = [];
  h.suppressed = [];
  vi.clearAllMocks();
});

const autoTunnel = (port: number): ActiveTunnel => ({
  id: `t${port}`, tunnel_type: "local", local_port: port, remote_port: port, remote_host: "127.0.0.1",
  bind_host: "127.0.0.1", target_host: null, origin: { type: "auto" }, state: "active", bytes_transferred: 0, remote_listening: true,
}) as unknown as ActiveTunnel;

test("renders nothing while the host has no forwards", () => {
  const { container } = render(<MobileActiveTunnels />);
  expect(container.innerHTML).toBe("");
});

test("an auto-detected forward shows on mobile and can be paused", () => {
  h.tunnels = [autoTunnel(5236)];
  render(<MobileActiveTunnels />);
  expect(screen.getByText("portForwarding.activeTunnels.portLabel:5236")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("portForwarding.activeTunnels.pauseForwarding"));
  expect(pf.closePfTunnel).toHaveBeenCalledWith("s1", "t5236");
});

test("a paused port can be resumed", () => {
  h.suppressed = [5236];
  render(<MobileActiveTunnels />);
  fireEvent.click(screen.getByLabelText("portForwarding.activeTunnels.resumeForwarding"));
  expect(pf.resumeAutoPort).toHaveBeenCalledWith("s1", 5236);
});
