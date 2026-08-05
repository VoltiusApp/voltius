import { describe, it, expect, vi } from "vitest";
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
}));
vi.mock("@voltius/ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConnectionAvatar: () => null,
}));
import { manifest, register } from "./index";
import { useAgentStore } from "./state/agentStore";
import { fakePanelHandle } from "./testing/fakePanelHandle";
import { TerminalAskButton } from "./ui/TerminalAskButton";

function fakeApi(isActive: () => boolean = () => true) {
  const calls: string[] = [];
  const panel = fakePanelHandle();
  const statusBarFactories: Record<string, (ctx: unknown) => unknown> = {};
  return {
    calls,
    statusBarFactories,
    panel,
    api: {
      isActive,
      storage: { get: vi.fn(async () => null), set: vi.fn() },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [], getActive: vi.fn(() => null) },
      connections: { list: async () => [] },
      terminal: { readSelection: vi.fn(() => ""), readSnapshot: vi.fn(() => "") },
      notifications: { toast: vi.fn() },
      i18n: { register: vi.fn(), t: (k: string) => k, getLocale: () => "en", onLocaleChange: () => () => {} },
      ui: {
        registerGlobalPanel: vi.fn(() => {
          calls.push("panel");
          const h = panel.handle as unknown as (() => void) & Record<string, unknown>;
          const dispose = () => { h(); calls.push("panel:off"); };
          return Object.assign(dispose, h) as never;
        }),
        registerStatusBarItem: vi.fn((slot: string, factory: (ctx: unknown) => unknown) => {
          statusBarFactories[slot] = factory;
          calls.push(slot === "titlebar.right" ? "titlebar" : "terminalButton");
          return () => calls.push(slot === "titlebar.right" ? "titlebar:off" : "terminalButton:off");
        }),
        registerSettingsPage: vi.fn(() => { calls.push("settings"); return () => calls.push("settings:off"); }),
      },
      omni: { register: vi.fn((c: { id: string }) => { calls.push(`omni:${c.id}`); return () => calls.push(`omni:${c.id}:off`); }) },
    } as never,
  };
}

describe("ai-agent register", () => {
  it("manifest declares the gated + public perms and is disabled by default", () => {
    expect(manifest.id).toBe("plugin-ai-agent");
    expect(manifest.defaultEnabled).toBe(false);
    expect(manifest.permissions).toEqual(expect.arrayContaining([
      "terminal:read", "terminal:stream", "keychain:read", "keychain:write",
      "global-panel", "omni-commands", "ui-contributions",
    ]));
  });
  it("registers drawer + omni + titlebar, and teardown unregisters all", () => {
    const { api, calls } = fakeApi();
    const cleanup = register(api);
    expect(calls).toEqual(expect.arrayContaining(["panel", "omni:ask-ai", "omni:ask-ai-terminal", "titlebar"]));
    cleanup?.();
    expect(calls).toEqual(expect.arrayContaining(["panel:off", "omni:ask-ai:off", "omni:ask-ai-terminal:off", "titlebar:off"]));
  });

  it("registers the terminal touchpoint (omni command + status-bar button), and teardown unregisters both", () => {
    const { api, calls } = fakeApi();
    const cleanup = register(api);
    expect((api as unknown as { omni: { register: ReturnType<typeof vi.fn> } }).omni.register)
      .toHaveBeenCalledWith(expect.objectContaining({ id: "ask-ai-terminal", keybinding: "ctrl+shift+j" }));
    expect(calls).toContain("omni:ask-ai-terminal");
    expect(calls).toContain("terminalButton");
    cleanup?.();
    expect(calls).toContain("omni:ask-ai-terminal:off");
    expect(calls).toContain("terminalButton:off");
  });

  it("registers a settings page only while active", () => {
    const { api } = fakeApi(() => true);
    register(api);
    expect((api as unknown as { ui: { registerSettingsPage: ReturnType<typeof vi.fn> } }).ui.registerSettingsPage)
      .toHaveBeenCalledWith(expect.objectContaining({ id: "settings", label: "AI Agent" }));
  });

  it("registers no settings page when inactive", () => {
    const { api } = fakeApi(() => false);
    register(api);
    expect((api as unknown as { ui: { registerSettingsPage: ReturnType<typeof vi.fn> } }).ui.registerSettingsPage)
      .not.toHaveBeenCalled();
  });

  it("unregisters the settings page on teardown", () => {
    const { api, calls } = fakeApi(() => true);
    const cleanup = register(api);
    cleanup?.();
    expect(calls).toContain("settings:off");
  });

  it("wires approval toasts while active and disposes them on teardown", () => {
    const { api } = fakeApi(() => true);
    const toast = (api as unknown as { notifications: { toast: ReturnType<typeof vi.fn> } }).notifications.toast;
    useAgentStore.setState({ pendingApprovals: [] });
    const cleanup = register(api);
    const pending = (id: string) => ({ id, tool: "run_command", args: {}, scope: "local", grants: [], resolve: vi.fn() });

    useAgentStore.getState()._addPending(pending("p1"));
    expect(toast).toHaveBeenCalledTimes(1);

    cleanup?.();
    useAgentStore.getState()._addPending(pending("p2"));
    // Still 1, not 2: proves the subscription installed by register was
    // actually torn down, not merely that a fresh one wasn't installed.
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("ask-ai-terminal execute() attaches terminal context from the active session and opens the drawer", () => {
    const { api, panel } = fakeApi();
    (api as unknown as { sessions: { getActive: unknown } }).sessions.getActive = vi.fn(() => ({
      id: "s1", connectionId: "c1", connectionName: "Prod DB", status: "connected", type: "ssh",
    }));
    (api as unknown as { terminal: { readSelection: unknown; readSnapshot: unknown } }).terminal = {
      readSelection: vi.fn(() => ""),
      readSnapshot: vi.fn(() => "line one\nline two"),
    };
    useAgentStore.setState({ pendingContext: null });

    register(api);
    const omniRegister = (api as unknown as { omni: { register: ReturnType<typeof vi.fn> } }).omni.register;
    const call = omniRegister.mock.calls.find((c: unknown[]) => (c[0] as { id: string }).id === "ask-ai-terminal")!;
    (call[0] as { execute: () => void }).execute();

    expect(useAgentStore.getState().pendingContext).toMatchObject({ sessionId: "s1", connectionName: "Prod DB" });
    expect(panel.state.open).toBe(true);
  });

  it("ask-ai-terminal execute() still opens the drawer with no context attached when there is no active session", () => {
    const { api, panel } = fakeApi(); // default sessions.getActive() returns null
    useAgentStore.setState({ pendingContext: null });

    register(api);
    const omniRegister = (api as unknown as { omni: { register: ReturnType<typeof vi.fn> } }).omni.register;
    const call = omniRegister.mock.calls.find((c: unknown[]) => (c[0] as { id: string }).id === "ask-ai-terminal")!;
    (call[0] as { execute: () => void }).execute();

    expect(useAgentStore.getState().pendingContext).toBeNull();
    expect(panel.state.open).toBe(true);
  });

  it("the terminal status-bar factory forwards sessionId and connectionName (falling back to connectionId) into TerminalAskButton", () => {
    const { api, statusBarFactories } = fakeApi();
    register(api);
    const factory = statusBarFactories["terminal.statusBar.right"];

    const withName = factory({ sessionId: "s1", connectionId: "c1", connectionName: "Prod DB" }) as {
      type: unknown; props: { sessionId: string; connectionName: string };
    };
    expect(withName.type).toBe(TerminalAskButton);
    expect(withName.props).toEqual({ sessionId: "s1", connectionName: "Prod DB" });

    const withoutName = factory({ sessionId: "s2", connectionId: "c2", connectionName: undefined }) as {
      props: { sessionId: string; connectionName: string };
    };
    expect(withoutName.props).toEqual({ sessionId: "s2", connectionName: "c2" });
  });
});
