import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  resolveRemoteSessions: vi.fn(),
  getToggle: vi.fn(),
  publishLiveSessionsNow: vi.fn(),
  removeSession: vi.fn(),
  reconnect: vi.fn(async () => {}),
  markClosed: vi.fn(),
  sessions: [] as { id: string; status: string }[],
  connections: [] as { id: string }[],
  teamConnections: {} as Record<string, { id: string }[]>,
}));

vi.mock("@/stores/liveSessionManifestCore", () => ({
  resolveRemoteSessions: h.resolveRemoteSessions,
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ getToggle: h.getToggle }));
vi.mock("@/services/liveSessionPublisher", () => ({ publishLiveSessionsNow: h.publishLiveSessionsNow }));
vi.mock("@/services/vault", () => ({})); // safety: avoid transitive tauri imports
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: { getState: () => ({ sessions: h.sessions, removeSession: h.removeSession, reconnect: h.reconnect }) },
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ connections: h.connections, teamConnections: h.teamConnections }) },
}));
vi.mock("@/stores/crossDeviceSessionsStore", () => ({
  useCrossDeviceSessionsStore: { getState: () => ({ manifests: {}, tombstones: {}, markClosed: h.markClosed }) },
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ setActiveNav: vi.fn(), setSidebarOpen: vi.fn() }) },
}));

import { getJoinableSessions, runClosedCheck, sessionEnded } from "./crossDeviceSessions";

beforeEach(() => {
  Object.values(h).forEach((v) => (v as { mockReset?: () => void }).mockReset?.());
  h.sessions = [];
  h.connections = [];
  h.teamConnections = {};
  h.resolveRemoteSessions.mockReturnValue({ joinable: [], closedIds: [] });
});

test("getJoinableSessions returns [] when toggle off (never calls resolver)", () => {
  h.getToggle.mockReturnValue(false);
  expect(getJoinableSessions()).toEqual([]);
  expect(h.resolveRemoteSessions).not.toHaveBeenCalled();
});

test("getJoinableSessions filters joinable to connections that exist (personal + team)", () => {
  h.getToggle.mockReturnValue(true);
  h.connections = [{ id: "c1" }];
  h.teamConnections = { t1: [{ id: "c2" }] };
  h.resolveRemoteSessions.mockReturnValue({
    joinable: [
      { sessionId: "s1", connectionId: "c1" },  // personal — kept
      { sessionId: "s2", connectionId: "c2" },  // team — kept
      { sessionId: "s3", connectionId: "cX" },  // unknown — dropped
    ],
    closedIds: [],
  });
  const out = getJoinableSessions();
  expect(out.map((j) => j.sessionId)).toEqual(["s1", "s2"]);
});

test("runClosedCheck is a no-op when toggle off", () => {
  h.getToggle.mockReturnValue(false);
  runClosedCheck();
  expect(h.removeSession).not.toHaveBeenCalled();
});

test("runClosedCheck no-op when closedIds empty", () => {
  h.getToggle.mockReturnValue(true);
  h.resolveRemoteSessions.mockReturnValue({ joinable: [], closedIds: [] });
  runClosedCheck();
  expect(h.removeSession).not.toHaveBeenCalled();
});

test("runClosedCheck removes non-connected closed tabs but PRESERVES a connected one", () => {
  h.getToggle.mockReturnValue(true);
  h.sessions = [
    { id: "dead", status: "connecting" },
    { id: "live", status: "connected" },   // connected-guard: keep
    { id: "gone", status: "error" },
  ];
  h.resolveRemoteSessions.mockReturnValue({ joinable: [], closedIds: ["dead", "live", "gone"] });
  runClosedCheck();
  expect(h.removeSession).toHaveBeenCalledWith("dead");
  expect(h.removeSession).toHaveBeenCalledWith("gone");
  expect(h.removeSession).not.toHaveBeenCalledWith("live");
  expect(h.removeSession).toHaveBeenCalledTimes(2);
});

test("runClosedCheck ignores closedIds with no matching local tab", () => {
  h.getToggle.mockReturnValue(true);
  h.sessions = [{ id: "here", status: "connecting" }];
  h.resolveRemoteSessions.mockReturnValue({ joinable: [], closedIds: ["absent"] });
  runClosedCheck();
  expect(h.removeSession).not.toHaveBeenCalled();
});

test("sessionEnded removes tab, tombstones it, and republishes", () => {
  sessionEnded("s5");
  expect(h.removeSession).toHaveBeenCalledWith("s5");
  expect(h.markClosed).toHaveBeenCalledWith("s5");
  expect(h.publishLiveSessionsNow).toHaveBeenCalledTimes(1);
});
