import { describe, test, expect } from "vitest";
import type { Connection, TerminalSession } from "@/types";
import { serialAutoReconnectEnabled } from "./serialAutoReconnect";

const session = (over: Partial<TerminalSession> = {}) =>
  ({ id: "s1", type: "serial", title: "esp32", status: "connected", ...over }) as unknown as TerminalSession;

const connection = (over: Partial<Connection> = {}) =>
  ({ id: "c1", name: "esp32", connection_type: "serial", ...over }) as unknown as Connection;

describe("serialAutoReconnectEnabled", () => {
  test("defaults to on when nothing has been set", () => {
    expect(serialAutoReconnectEnabled(session(), connection())).toBe(true);
  });

  test("the connection's stored preference wins", () => {
    expect(serialAutoReconnectEnabled(session(), connection({ serial_auto_reconnect: false }))).toBe(false);
    expect(serialAutoReconnectEnabled(session(), connection({ serial_auto_reconnect: true }))).toBe(true);
  });

  test("an ephemeral serial session falls back to its own flag", () => {
    expect(serialAutoReconnectEnabled(session({ autoReconnect: false }), undefined)).toBe(false);
    expect(serialAutoReconnectEnabled(session(), undefined)).toBe(true);
  });

  test("ssh sessions are never gated", () => {
    expect(
      serialAutoReconnectEnabled(
        session({ type: "ssh", autoReconnect: false }),
        connection({ serial_auto_reconnect: false }),
      ),
    ).toBe(true);
  });
});
