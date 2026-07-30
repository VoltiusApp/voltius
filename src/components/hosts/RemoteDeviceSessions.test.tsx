import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const getJoinableSessions = vi.fn();
const joinRemoteSession = vi.fn();
const killRemoteSession = vi.fn();

vi.mock("@/services/crossDeviceSessions", () => ({
  getJoinableSessions: () => getJoinableSessions(),
  joinRemoteSession: (...a: unknown[]) => joinRemoteSession(...a),
  killRemoteSession: (...a: unknown[]) => killRemoteSession(...a),
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ useToggle: () => [true] }));
vi.mock("@/stores/crossDeviceSessionsStore", () => ({
  useCrossDeviceSessionsStore: (sel: (s: unknown) => unknown) => sel({ manifests: {} }),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (sel: (s: unknown) => unknown) => sel({ sessions: [] }),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: (sel: (s: unknown) => unknown) => sel({ connections: [] }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
// AvatarTile pulls in @/utils/icons, which imports the vite-only
// `virtual:lucide-subset` module. That plugin is registered in vite.config.ts
// (the app build) but not in vitest.config.ts (test runner), so any real,
// unmocked import of AvatarTile fails module resolution under vitest. Every
// existing test that touches BaseCard/AvatarTile mocks one of them away for
// the same reason (see TeamSessions.test.tsx); do the same here so the real
// BaseCard/ContextMenu (which this test exercises) still run unmocked.
vi.mock("@/components/shared/AvatarTile", () => ({ AvatarTile: () => null }));

import { RemoteDeviceSessions } from "./RemoteDeviceSessions";

const card = { sessionId: "s1", connectionId: "c1", connectionName: "web", deviceId: "d", deviceName: "D", openedAt: new Date().toISOString() };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  getJoinableSessions.mockReturnValue([card]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function rightClickKill() {
  fireEvent.contextMenu(screen.getByText("web"));
  fireEvent.click(screen.getByText("hosts.remoteSessions.kill"));
}

describe("RemoteDeviceSessions kill", () => {
  it("enters killing state on Kill, and Undo cancels without killing", () => {
    render(<RemoteDeviceSessions />);
    rightClickKill();
    expect(screen.getByText("hosts.remoteSessions.undo")).toBeTruthy();
    fireEvent.click(screen.getByText("hosts.remoteSessions.undo"));
    act(() => vi.advanceTimersByTime(5000));
    expect(killRemoteSession).not.toHaveBeenCalled();
  });

  it("commits the kill after the 5s window", async () => {
    killRemoteSession.mockResolvedValue({ ok: true });
    render(<RemoteDeviceSessions />);
    rightClickKill();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(killRemoteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1" }));
  });
});
