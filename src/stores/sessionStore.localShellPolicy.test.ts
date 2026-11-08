// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  snapshot: {
    version: 1,
    sessions: [{ id: "r1", connectionId: "local", connectionName: "Bash", type: "local", localShell: "/bin/bash" }],
    layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] },
    activeSessionId: "r1",
  },
}));

const invoke = vi.fn();
vi.mock("@/lib/invoke", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("./workspaceSnapshotStore", () => ({
  readWorkspaceSnapshot: () => h.snapshot,
  clearWorkspaceSnapshot: vi.fn(),
  startWorkspaceSnapshotSync: vi.fn(),
}));
vi.mock("./toggleSettingsStore", () => ({ getToggle: () => true }));
vi.mock("@/hooks/useTerminal", () => ({ setRestoreScrollOffset: vi.fn() }));

import { useSessionStore } from "./sessionStore";
import { usePolicyStore } from "./policyStore";

const KEY = "appSettings.terminal.preferredShell";
const shells = [
  { name: "bash", path: "/bin/bash" },
  { name: "zsh", path: "/bin/zsh" },
];
const setPolicy = (value: unknown) => usePolicyStore.setState({ machine: { policy: { [KEY]: value }, defaults: {} } });
const flush = () => new Promise((r) => setTimeout(r, 400));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => (cmd === "local_list_shells" ? shells : undefined));
  useSessionStore.setState({ sessions: [], activeSessionId: null });
  setPolicy({ $range: { allowed: ["zsh"] } });
});

afterEach(() => usePolicyStore.setState({ machine: { policy: {}, defaults: {} } }));

describe("local shell policy on session tabs", () => {
  test("beginLocalSession names the shell that runs", async () => {
    const id = useSessionStore.getState().beginLocalSession("/bin/bash");
    await flush();
    const s = useSessionStore.getState().sessions.find((x) => x.id === id)!;
    expect(s.localShell).toBe("/bin/zsh");
    expect(s.connectionName).toMatch(/zsh/i);
    expect(s.status).toBe("connected");
  });

  test("connectLocal under a name lock spawns the detected path", async () => {
    setPolicy("ZSH");
    await useSessionStore.getState().connectLocal();
    expect(useSessionStore.getState().sessions[0].localShell).toBe("/bin/zsh");
  });

  test("connectLocal names the shell that runs", async () => {
    await useSessionStore.getState().connectLocal();
    const s = useSessionStore.getState().sessions[0];
    expect(s.localShell).toBe("/bin/zsh");
    expect(s.connectionName).toMatch(/zsh/i);
  });

  test("a custom tab name survives the shell swap", async () => {
    const id = useSessionStore.getState().beginLocalSession("/bin/bash");
    useSessionStore.setState((st) => ({ sessions: st.sessions.map((x) => ({ ...x, connectionName: "deploy" })) }));
    await flush();
    expect(useSessionStore.getState().sessions.find((x) => x.id === id)!.connectionName).toBe("deploy");
  });

  test("every local spawn settles connected the same way", async () => {
    const id = useSessionStore.getState().beginLocalSession("/bin/zsh");
    await flush();
    await useSessionStore.getState().connectLocal();
    for (const s of useSessionStore.getState().sessions) expect([s.status, s.everConnected], s.id).toEqual(["connected", true]);
    expect(id).toBeTruthy();
  });

  test("a failed local spawn keeps its error message", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "local_list_shells") return shells;
      if (cmd === "local_connect") throw new Error("pty refused");
    });
    await expect(useSessionStore.getState().connectLocal()).rejects.toThrow("pty refused");
    const id = useSessionStore.getState().beginLocalSession("/bin/zsh");
    await flush();
    for (const s of useSessionStore.getState().sessions) expect([s.status, s.errorMessage], s.id).toEqual(["error", "pty refused"]);
    expect(id).toBeTruthy();
  });

  test("workspace restore of a bash snapshot under a zsh lock ends with zsh", async () => {
    const { formatLocalShellTitle } = await import("@/utils/localShellTitle");
    h.snapshot.sessions[0].connectionName = formatLocalShellTitle("/bin/bash");
    const { restoreWorkspaceOnLaunch } = await import("./workspaceRestore");
    await restoreWorkspaceOnLaunch();
    const s = useSessionStore.getState().sessions.find((x) => x.id === "r1")!;
    expect(s.localShell).toBe("/bin/zsh");
    expect(s.connectionName).toMatch(/zsh/i);
  });
});
