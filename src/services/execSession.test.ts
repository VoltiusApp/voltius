// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from "vitest";
import type { TerminalSession } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { useSessionStore } from "@/stores/sessionStore";
import { registerExecSession } from "./execSession";

const parent = { id: "p1", connectionId: "c1", connectionName: "pve", status: "connected", type: "ssh", connectedUsername: "alice" } as TerminalSession;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => cb());
  useSessionStore.setState({ sessions: [parent], activeSessionId: "p1" });
});

test("an LXC exec child shows the user its parent connected as", async () => {
  await registerExecSession("e1", "pct: 101", { kind: "lxc", vmid: 101, parentSessionId: "p1" });
  expect(useSessionStore.getState().sessions.find((s) => s.id === "e1")?.connectedUsername).toBe("alice");
});

test("a docker exec child joins its parent's connection, active and connected", async () => {
  await registerExecSession("e2", "exec: web", { kind: "docker", containerId: "abc", parentSessionId: "p1" });
  const { sessions, activeSessionId } = useSessionStore.getState();
  expect(activeSessionId).toBe("e2");
  expect(sessions.find((s) => s.id === "e2")).toMatchObject({
    connectionId: "c1",
    connectionName: "exec: web",
    status: "connected",
    containerExec: { kind: "docker", containerId: "abc", parentSessionId: "p1" },
  });
});
