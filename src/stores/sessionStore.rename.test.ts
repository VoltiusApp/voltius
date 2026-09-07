import { describe, test, expect, vi, beforeEach } from "vitest";
import type { TerminalSession } from "@/types";

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
  useConnectionStore: { getState: () => ({ connections: [], teamConnections: {}, setLastUsed: vi.fn(async () => {}) }) },
  connectionToFormData: vi.fn(),
}));
vi.mock("./layoutStore", () => ({ useLayoutStore: { getState: () => ({ setSplitTabActive: vi.fn() }) } }));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

import { useSessionStore } from "./sessionStore";

const session: TerminalSession = { id: "s1", connectionId: "c1", connectionName: "srv", status: "connected", type: "ssh" };

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessions: [session, { ...session, id: "s2" }], activeSessionId: "s1" });
});

const titles = () => useSessionStore.getState().sessions.map((s) => s.title);

describe("renameSession", () => {
  test("names one session and leaves its neighbours alone", () => {
    useSessionStore.getState().renameSession("s1", "deploy");
    expect(titles()).toEqual(["deploy", undefined]);
  });

  test("stores what the user typed, trimmed", () => {
    useSessionStore.getState().renameSession("s1", "  deploy  ");
    expect(titles()[0]).toBe("deploy");
  });

  test("a blank name returns the tab to its connection name", () => {
    useSessionStore.getState().renameSession("s1", "deploy");
    useSessionStore.getState().renameSession("s1", "");
    expect(titles()[0]).toBeUndefined();
  });

  test("renaming an unknown session changes nothing", () => {
    useSessionStore.getState().renameSession("gone", "deploy");
    expect(titles()).toEqual([undefined, undefined]);
  });
});
