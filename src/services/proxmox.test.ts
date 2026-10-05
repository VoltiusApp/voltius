// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from "vitest";
import type { TerminalSession } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { useSessionStore } from "@/stores/sessionStore";
import { registerLxcExecSession } from "./proxmox";

const parent = { id: "p1", connectionId: "c1", connectionName: "pve", status: "connected", type: "ssh", connectedUsername: "alice" } as TerminalSession;

beforeEach(() => useSessionStore.setState({ sessions: [parent], activeSessionId: "p1" }));

test("an LXC exec child shows the user its parent connected as", async () => {
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => cb());
  await registerLxcExecSession({ execSessionId: "e1", parentSessionId: "p1", connectionId: "c1", vmid: 101 });
  expect(useSessionStore.getState().sessions.find((s) => s.id === "e1")?.connectedUsername).toBe("alice");
});
