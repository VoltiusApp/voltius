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
// AvatarTile is mocked to keep this test on the real BaseCard/ContextMenu
// (what it exercises) without dragging in the icon pipeline it pulls via
// @/utils/icons, same as the other BaseCard/AvatarTile tests (see
// TeamSessions.test.tsx).
vi.mock("@/components/shared/AvatarTile", () => ({ AvatarTile: () => null }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

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

  it("shows a dismissible failure card with the host name when the kill fails", async () => {
    killRemoteSession.mockResolvedValue({ ok: false, reason: "unsupported" });
    render(<RemoteDeviceSessions />);
    rightClickKill();
    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => {});

    expect(screen.getByText("hosts.remoteSessions.killFailed")).toBeTruthy();
    expect(screen.getByText("web")).toBeTruthy();
    const dismissButton = screen.getByText("hosts.remoteSessions.dismiss");
    expect(dismissButton).toBeTruthy();

    fireEvent.click(dismissButton);
    expect(screen.queryByText("hosts.remoteSessions.killFailed")).toBeNull();
  });
});
