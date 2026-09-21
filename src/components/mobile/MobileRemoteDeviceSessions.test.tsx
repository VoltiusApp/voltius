import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const getJoinableSessions = vi.fn();

vi.mock("@/services/crossDeviceSessions", () => ({
  getJoinableSessions: () => getJoinableSessions(),
  joinRemoteSession: vi.fn(),
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
vi.mock("@/stores/mobileNavStore", () => ({
  useMobileNavStore: (sel: (s: unknown) => unknown) => sel({ setTab: vi.fn() }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

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
