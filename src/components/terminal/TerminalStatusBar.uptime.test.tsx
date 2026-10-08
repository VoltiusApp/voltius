import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { TerminalStatusBar } from "./TerminalStatusBar";
import { useSessionStore } from "@/stores/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [], useConnection: () => undefined }));

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({ sessions: [{ id: "s1", connectionId: "local", connectionName: "Local", status: "connected", type: "local" }] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useSessionStore.setState({ sessions: [] });
});

const bar = (visible: boolean) => (
  <TerminalStatusBar sessionId="s1" sessionType="local" connectionId="local" sessionStatus="connected" visible={visible} />
);

test("a hidden status bar stops ticking its uptime and catches up when shown", () => {
  const { rerender } = render(bar(true));
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("00:00:02")).toBeTruthy();

  rerender(bar(false));
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText("00:00:02")).toBeTruthy();

  rerender(bar(true));
  expect(screen.getByText("00:00:07")).toBeTruthy();
});
