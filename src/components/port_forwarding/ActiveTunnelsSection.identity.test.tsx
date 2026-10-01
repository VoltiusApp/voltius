import { test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Connection, TerminalSession } from "@/types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const h = vi.hoisted(() => ({ session: null as unknown as TerminalSession }));
const host = { id: "c1", name: "web-1", host: "web-01", port: 2222, username: "root", connection_type: "ssh" } as unknown as Connection;

vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [host] }));
vi.mock("@/hooks/usePfStates", () => ({
  useConnectedSshPfStates: () => ({ sessions: [h.session], pfStates: new Map([["s1", { tunnels: [], suppressed_ports: [8080] }]]) }),
}));

import { ActiveTunnelsSection } from "./ActiveTunnelsSection";

afterEach(cleanup);

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
