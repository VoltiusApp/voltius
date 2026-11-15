// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";
import type { TerminalSession } from "@/types";

const sshDisconnect = vi.hoisted(() => vi.fn(async () => true));
const appToast = vi.hoisted(() => vi.fn());

vi.mock("@/services/ssh", () => ({
  sshConnect: vi.fn(async () => {}),
  sshDisconnect,
  sshDisconnectForReconnect: vi.fn(async () => {}),
  sshDetectDistro: vi.fn(async () => null),
  sshSendInput: vi.fn(async () => {}),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ connections: [], teamConnections: {} }) },
  connectionToFormData: vi.fn(),
  findAnyConnection: vi.fn(() => undefined),
}));
vi.mock("@/services/appToast", () => ({ appToast }));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));

import { useSessionStore } from "./sessionStore";
import { closeConnectionsLost } from "@/services/revokedConnections";

const session = (id: string, connectionId: string, type: TerminalSession["type"] = "ssh"): TerminalSession => ({
  id,
  connectionId,
  connectionName: `${connectionId}-name`,
  status: "connected",
  type,
  persist: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({
    sessions: [session("s1", "c1"), session("s2", "c2"), session("s3", "c1", "multiplayer")],
    activeSessionId: "s1",
  });
});

test("a revoked host's terminals close and the rest stay open", async () => {
  closeConnectionsLost("t1", ["c1"]);

  await vi.waitFor(() => expect(useSessionStore.getState().sessions.map((s) => s.id)).toEqual(["s2", "s3"]));
  expect(appToast).toHaveBeenCalledTimes(1);
  expect(appToast.mock.calls[0][1]).toContain("c1-name");
});

test("closing a revoked host's persistent session detaches without killing it", async () => {
  closeConnectionsLost("t1", ["c1"]);

  await vi.waitFor(() => expect(sshDisconnect).toHaveBeenCalled());
  expect(sshDisconnect.mock.calls).toEqual([["s1", undefined, false, true]]);
});
