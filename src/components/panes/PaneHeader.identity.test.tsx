import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { PaneHeader } from "./PaneHeader";
import type { Connection, TerminalSession } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({
  getConnectionIcon: () => null,
  getConnectionIconColor: () => null,
  getDistroColor: () => null,
  getDistroIcon: () => "lucide:server",
  getDistroLabel: () => "",
}));

const host = { id: "c1", name: "web-1", host: "web-01", port: 22, username: "root", connection_type: "ssh" } as unknown as Connection;
const session: TerminalSession = { id: "s1", connectionId: "c1", connectionName: "web-1", status: "connected", type: "ssh" };

beforeEach(() => {
  useConnectionStore.setState({ connections: [host], teamConnections: {} });
  useSessionStore.setState({ sessions: [session], activeSessionId: "s1" });
});
afterEach(cleanup);

test("a live session shows the user it connected as", () => {
  render(<PaneHeader paneId="p1" session={{ ...session, connectedUsername: "alice" }} active />);
  expect(screen.getByText("alice@web-01")).toBeTruthy();
});

test("a session with no recorded user shows the host's, as before", () => {
  render(<PaneHeader paneId="p1" session={session} active />);
  expect(screen.getByText("root@web-01")).toBeTruthy();
});
