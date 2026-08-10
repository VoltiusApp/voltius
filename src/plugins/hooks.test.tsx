import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { PluginAPI, PluginSession } from "@/plugins/api";
import { useActiveSession } from "./hooks";

afterEach(cleanup);

function session(id: string, over: Partial<PluginSession> = {}): PluginSession {
  return { id, type: "ssh", status: "connected", ...over } as PluginSession;
}

/** Minimal stand-in for the sessions slice, with hand-fired lifecycle events. */
function fakeApi(active: PluginSession | null) {
  const listeners = {
    activated: [] as ((s: PluginSession) => void)[],
    connected: [] as ((s: PluginSession) => void)[],
    disconnected: [] as ((s: PluginSession) => void)[],
  };
  const offCalls: string[] = [];
  const sub = (kind: keyof typeof listeners) => (cb: (s: PluginSession) => void) => {
    listeners[kind].push(cb);
    return () => {
      offCalls.push(kind);
      listeners[kind] = listeners[kind].filter((x) => x !== cb);
    };
  };
  const api = {
    sessions: {
      getActive: vi.fn(() => active),
      onActivated: sub("activated"),
      onConnected: sub("connected"),
      onDisconnected: sub("disconnected"),
    },
  } as unknown as PluginAPI;
  const emit = (kind: keyof typeof listeners, s: PluginSession) =>
    act(() => { for (const cb of [...listeners[kind]]) cb(s); });
  return { api, emit, offCalls };
}

function mount(api: PluginAPI | null) {
  const seen: (PluginSession | null)[] = [];
  function Probe() {
    seen.push(useActiveSession(api));
    return null;
  }
  const view = render(<Probe />);
  return { seen, view, last: () => seen[seen.length - 1] };
}

describe("useActiveSession", () => {
  test("starts from the host's current active session", () => {
    const { api } = fakeApi(session("a"));
    expect(mount(api).last()?.id).toBe("a");
  });

  test("a null api yields null and subscribes to nothing", () => {
    const { last } = mount(null);
    expect(last()).toBeNull();
  });

  test("activation replaces the session outright", () => {
    const { api, emit } = fakeApi(session("a"));
    const { last } = mount(api);
    emit("activated", session("b"));
    expect(last()?.id).toBe("b");
  });

  test("a connect event for another session is ignored", () => {
    const { api, emit } = fakeApi(session("a", { status: "connecting" }));
    const { last } = mount(api);
    emit("connected", session("b"));
    expect(last()?.id).toBe("a");
    expect(last()?.status).toBe("connecting");
  });

  test("a connect event for the current session refreshes it", () => {
    const { api, emit } = fakeApi(session("a", { status: "connecting" }));
    const { last } = mount(api);
    emit("connected", session("a", { status: "connected" }));
    expect(last()?.status).toBe("connected");
  });

  test("a disconnect for the current session marks it disconnected", () => {
    const { api, emit } = fakeApi(session("a"));
    const { last } = mount(api);
    emit("disconnected", session("a"));
    expect(last()?.status).toBe("disconnected");
  });

  test("a disconnect for another session leaves the current one alone", () => {
    const { api, emit } = fakeApi(session("a"));
    const { last } = mount(api);
    emit("disconnected", session("b"));
    expect(last()?.status).toBe("connected");
  });

  test("unmount releases all three subscriptions", () => {
    const { api, offCalls } = fakeApi(session("a"));
    const { view } = mount(api);
    view.unmount();
    expect(offCalls.sort()).toEqual(["activated", "connected", "disconnected"]);
  });
});
