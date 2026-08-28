import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Connection, TerminalSession } from "@/types";

const connection = {
  id: "c1",
  name: "esp32",
  connection_type: "serial",
  serial_port: "/dev/ttyUSB0",
  serial_baud: 115200,
} as unknown as Connection;

const h = vi.hoisted(() => ({
  statusWhenReleased: [] as (string | undefined)[],
  serialDisconnect: vi.fn(async () => {}),
  serialConnect: vi.fn(async () => {}),
  cancelBackoff: vi.fn(),
  updateConnection: vi.fn(async () => {}),
}));

vi.mock("@/services/serial", () => ({
  serialConnect: h.serialConnect,
  serialDisconnect: h.serialDisconnect,
  serialListPorts: vi.fn(async () => []),
}));
vi.mock("@/services/ssh", () => ({
  sshConnect: vi.fn(async () => {}),
  sshDisconnect: vi.fn(async () => true),
  sshDisconnectForReconnect: vi.fn(async () => {}),
  sshDetectDistro: vi.fn(async () => null),
  sshSendInput: vi.fn(async () => {}),
}));
vi.mock("./reconnectBackoffCore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reconnectBackoffCore")>()),
  cancelBackoff: h.cancelBackoff,
}));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "root" })),
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [connection],
      teamConnections: {},
      setLastUsed: vi.fn(async () => {}),
      updateConnection: h.updateConnection,
    }),
  },
  connectionToFormData: (c: Connection) => ({ name: c.name, connection_type: c.connection_type }),
}));
vi.mock("./layoutStore", () => ({
  useLayoutStore: { getState: () => ({ setSplitTabActive: vi.fn(), removeSession: vi.fn() }) },
}));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

import { useSessionStore } from "./sessionStore";

const session = (over: Partial<TerminalSession> = {}) =>
  ({
    id: "s1",
    type: "serial",
    connectionId: "c1",
    title: "esp32",
    status: "connected",
    serialConfig: { sessionId: "s1", port: "/dev/ttyUSB0", baud: 115200 },
    ...over,
  }) as unknown as TerminalSession;

function seed(over: Partial<TerminalSession> = {}) {
  useSessionStore.setState({ sessions: [session(over)], activeSessionId: "s1" });
}

const current = () => useSessionStore.getState().sessions.find((s) => s.id === "s1");

describe("closeSerialPort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.statusWhenReleased.length = 0;
    h.serialDisconnect.mockImplementation(async () => {
      h.statusWhenReleased.push(current()?.status);
    });
  });

  test("releases the port but keeps the tab and its config", async () => {
    seed();
    await useSessionStore.getState().closeSerialPort("s1");

    expect(h.serialDisconnect).toHaveBeenCalledWith("s1");
    expect(current()?.status).toBe("disconnected");
    expect(current()?.serialConfig).toBeDefined();
  });

  // The backend emits serial-closed the moment the port drops; if the session
  // still read 'connected' then, handleSessionClosed would start the backoff
  // loop and immediately reclaim the port the user asked to free.
  test("marks the session disconnected before the port is released", async () => {
    seed();
    await useSessionStore.getState().closeSerialPort("s1");

    expect(h.statusWhenReleased).toEqual(["disconnected"]);
  });

  test("cancels any reconnect loop already in flight", async () => {
    seed({ status: "connecting" });
    await useSessionStore.getState().closeSerialPort("s1");

    expect(h.cancelBackoff).toHaveBeenCalledWith("s1");
  });

  test("ignores a session that is not serial", async () => {
    seed({ type: "ssh" });
    await useSessionStore.getState().closeSerialPort("s1");

    expect(h.serialDisconnect).not.toHaveBeenCalled();
    expect(current()?.status).toBe("connected");
  });
});

describe("setSerialAutoReconnect", () => {
  beforeEach(() => vi.clearAllMocks());

  test("persists a saved connection's preference on the connection", async () => {
    seed();
    await useSessionStore.getState().setSerialAutoReconnect("s1", false);

    expect(h.updateConnection).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ name: "esp32", serial_auto_reconnect: false }),
    );
  });

  // Quick-connect serial sessions carry a sentinel id that no connection store
  // resolves, so there is nothing to persist the preference on.
  test("stores an ephemeral session's preference on the session", async () => {
    seed({ connectionId: "serial-ephemeral" });
    await useSessionStore.getState().setSerialAutoReconnect("s1", false);

    expect(current()?.autoReconnect).toBe(false);
  });
});
