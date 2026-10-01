import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TerminalStatusBar } from "./TerminalStatusBar";
import { useSessionStore } from "@/stores/sessionStore";
import type { TerminalSession } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useAllConnections", () => ({
  useAllConnections: () => [{ id: "c1", username: "root", host: "web-01", port: 22 }],
}));

afterEach(() => {
  cleanup();
  useSessionStore.setState({ sessions: [] });
});

const renderFor = (session: Partial<TerminalSession>) => {
  useSessionStore.setState({ sessions: [{ id: "s1", connectionId: "c1", connectionName: "web-01", status: "connected", type: "ssh", ...session }] });
  render(<TerminalStatusBar sessionId="s1" sessionType="ssh" connectionId="c1" sessionStatus="connected" />);
};

test("the status bar shows the user the session authenticated as", () => {
  renderFor({ connectedUsername: "alice" });
  expect(screen.getByText("alice@web-01")).toBeTruthy();
});

test("a session with no recorded user shows the host's, as before", () => {
  renderFor({});
  expect(screen.getByText("root@web-01")).toBeTruthy();
});
