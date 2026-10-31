// @vitest-environment jsdom
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
  persist_session: true,
} as unknown as Connection;

const sshConnect = vi.hoisted(() => vi.fn(async (_p: Record<string, unknown>) => {}));

vi.mock("@/services/ssh", () => ({
  sshConnect,
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
  useLayoutStore: { getState: () => ({ setSplitTabActive: vi.fn() }) },
}));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

import { useSessionStore } from "./sessionStore";
import { useToggleSettingsStore } from "./toggleSettingsStore";

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessions: [], activeSessionId: null });
  useToggleSettingsStore.getState().set("persistent-sessions", true);
  useToggleSettingsStore.getState().set("detached-session-ttl", true);
});

describe("detached-session TTL on connect", () => {
  test("persistent-by-host-override still gets the TTL when the global persistence toggle is off", async () => {
    useToggleSettingsStore.getState().set("persistent-sessions", false);
    await useSessionStore.getState().connect("c1");

    expect(sshConnect).toHaveBeenCalledTimes(1);
    const args = sshConnect.mock.calls[0][0];
    expect(args.persist).toBe(true);
    expect(args.detachedTtlSecs).toBe(86400);
  });

  test("TTL toggle off sends null", async () => {
    useToggleSettingsStore.getState().set("detached-session-ttl", false);
    await useSessionStore.getState().connect("c1");

    expect(sshConnect.mock.calls[0][0].detachedTtlSecs).toBeNull();
  });
});
