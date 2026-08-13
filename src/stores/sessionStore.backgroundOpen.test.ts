import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";

const connection = {
  id: "c1",
  name: "srv",
  host: "h1",
  port: 22,
  username: "root",
  password: "pw",
  connection_type: "ssh",
} as unknown as Connection;

const setSplitTabActive = vi.fn();

vi.mock("@/services/ssh", () => ({
  sshConnect: vi.fn(async () => {}),
  sshDisconnect: vi.fn(async () => true),
  sshDisconnectForReconnect: vi.fn(async () => {}),
  sshDetectDistro: vi.fn(async () => null),
  sshSendInput: vi.fn(async () => {}),
}));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "root", password: "pw" })),
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [connection],
      teamConnections: {},
      setLastUsed: vi.fn(async () => {}),
    }),
  },
  connectionToFormData: vi.fn(),
}));
vi.mock("./layoutStore", () => ({
  useLayoutStore: { getState: () => ({ setSplitTabActive }) },
}));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

import { useSessionStore } from "./sessionStore";

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessions: [], activeSessionId: null });
});

describe("background open", () => {
  test("a background open leaves the user's active tab and split view alone", async () => {
    await useSessionStore.getState().connect("c1");
    const userTab = useSessionStore.getState().activeSessionId;
    expect(userTab).not.toBeNull();
    setSplitTabActive.mockClear();

    await useSessionStore.getState().connect("c1", { background: true });

    expect(useSessionStore.getState().sessions).toHaveLength(2);
    expect(useSessionStore.getState().activeSessionId).toBe(userTab);
    expect(setSplitTabActive).not.toHaveBeenCalled();
  });

  test("a background open with no session yet still takes focus", async () => {
    await useSessionStore.getState().connect("c1", { background: true });

    const { sessions, activeSessionId } = useSessionStore.getState();
    expect(activeSessionId).toBe(sessions[0].id);
    expect(setSplitTabActive).toHaveBeenCalledWith(false);
  });

  test("a normal open still focuses the new tab", async () => {
    await useSessionStore.getState().connect("c1");
    const first = useSessionStore.getState().activeSessionId;
    await useSessionStore.getState().connect("c1");

    expect(useSessionStore.getState().activeSessionId).not.toBe(first);
  });
});
