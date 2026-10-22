import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

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
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/AvatarTile", () => ({ AvatarTile: () => null }));

import MobileRemoteDeviceSessions from "./MobileRemoteDeviceSessions";

const card = {
  sessionId: "s1",
  connectionId: "c1",
  connectionName: "web",
  deviceId: "d",
  deviceName: "D",
  openedAt: new Date().toISOString(),
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("MobileRemoteDeviceSessions label", () => {
  it("shows the renamed session title", () => {
    getJoinableSessions.mockReturnValue([{ ...card, title: "deploy box" }]);
    render(<MobileRemoteDeviceSessions />);
    expect(screen.getByText("deploy box")).toBeTruthy();
    expect(screen.queryByText("web")).toBeNull();
  });

  it("falls back to the connection name", () => {
    getJoinableSessions.mockReturnValue([card]);
    render(<MobileRemoteDeviceSessions />);
    expect(screen.getByText("web")).toBeTruthy();
  });
});

describe("MobileRemoteDeviceSessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getJoinableSessions.mockReturnValue([card]);
    joinRemoteSession.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("titles the strip with the desktop key and the desktop subtitle", () => {
    render(<MobileRemoteDeviceSessions />);
    expect(screen.getByText("hosts.remoteSessions.title")).toBeTruthy();
    expect(screen.getByText("hosts.remoteSessions.deviceActive")).toBeTruthy();
  });

  it("joins on tap", () => {
    render(<MobileRemoteDeviceSessions />);
    fireEvent.click(screen.getByText("web"));
    expect(joinRemoteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1" }));
  });

  it("long-press opens the actions sheet, and Kill runs the undoable kill", async () => {
    killRemoteSession.mockResolvedValue({ ok: true });
    render(<MobileRemoteDeviceSessions />);
    fireEvent.contextMenu(screen.getByText("web"));
    expect(joinRemoteSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("hosts.remoteSessions.kill"));
    expect(screen.getByText("hosts.remoteSessions.killing")).toBeTruthy();
    expect(killRemoteSession).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(killRemoteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1" }));
  });

  it("Undo during the window keeps the session", async () => {
    render(<MobileRemoteDeviceSessions />);
    fireEvent.contextMenu(screen.getByText("web"));
    fireEvent.click(screen.getByText("hosts.remoteSessions.kill"));
    fireEvent.click(screen.getByText("hosts.remoteSessions.undo"));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(killRemoteSession).not.toHaveBeenCalled();
    expect(screen.getByText("web")).toBeTruthy();
  });
});
