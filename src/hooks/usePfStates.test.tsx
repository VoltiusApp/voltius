import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { PfSessionState } from "@/services/portForwardingTunnels";
import type { ActiveTunnel, TerminalSession } from "@/types";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({ useAccessibleVaultIds: () => [] }));
type SessionsStore = UseBoundStore<StoreApi<{ sessions: Pick<TerminalSession, "id" | "status">[] }>>;
const sessionStore = vi.hoisted(() => ({ current: null as unknown as SessionsStore }));
vi.mock("@/stores/sessionStore", () => {
  sessionStore.current = create(() => ({ sessions: [] as Pick<TerminalSession, "id" | "status">[] }));
  return { useSessionStore: sessionStore.current };
});

let usePfStates: typeof import("./usePfStates").usePfStates;
let usePfState: typeof import("./usePfStates").usePfState;

const state = (...ids: string[]): PfSessionState => ({
  tunnels: ids.map((id) => ({ id }) as ActiveTunnel),
  suppressed_ports: [],
});
const tunnelIds = (s: PfSessionState | undefined) => s?.tunnels.map((t) => t.id);

/** Pending pf_get_state replies per session, oldest first, released by the test. */
let replies: Map<string, ((s: PfSessionState) => void)[]>;
const reply = (sessionId: string, s: PfSessionState) => replies.get(sessionId)!.shift()!(s);
let emit: (sessionId: string, s: PfSessionState) => void;

beforeEach(async () => {
  vi.resetModules();
  replies = new Map();
  h.invoke.mockReset().mockImplementation((_cmd: string, { sessionId }: { sessionId: string }) =>
    new Promise((resolve) => replies.set(sessionId, [...(replies.get(sessionId) ?? []), resolve])),
  );
  h.listen.mockReset().mockImplementation(async (_event: string, cb: (e: { payload: unknown }) => void) => {
    emit = (sessionId, s) => cb({ payload: { session_id: sessionId, ...s } });
    return () => {};
  });
  ({ usePfStates, usePfState } = await import("./usePfStates"));
});
afterEach(() => cleanup());

test("a fetch for the previous session does not paint over the new one", async () => {
  const { result, rerender } = renderHook(({ id }) => usePfState(id), { initialProps: { id: "a" } });
  rerender({ id: "b" });
  await act(async () => reply("a", state("a-tunnel")));
  expect(result.current).toBeUndefined();

  await act(async () => reply("b", state("b-tunnel")));
  expect(tunnelIds(result.current)).toEqual(["b-tunnel"]);
});

test("every hook shares one listener and one fetch per session", async () => {
  const first = renderHook(() => usePfState("a"));
  const second = renderHook(() => usePfStates(["a", "b"]));
  expect(h.listen).toHaveBeenCalledTimes(1);
  expect(h.invoke.mock.calls.map(([, args]) => args.sessionId)).toEqual(["a", "b"]);

  await act(async () => reply("a", state("a1")));
  expect(tunnelIds(first.result.current)).toEqual(["a1"]);
  expect(tunnelIds(second.result.current.get("a"))).toEqual(["a1"]);
});

test("events keep each tracked session current and ignore the rest", async () => {
  const { result } = renderHook(() => usePfStates(["a", "b"]));
  await act(async () => {
    reply("a", state("a1"));
    reply("b", state("b1"));
  });
  act(() => {
    emit("a", state("a1", "a2"));
    emit("other", state("x"));
  });
  expect(tunnelIds(result.current.get("a"))).toEqual(["a1", "a2"]);
  expect(tunnelIds(result.current.get("b"))).toEqual(["b1"]);
  expect(result.current.has("other")).toBe(false);
});

test("a fetch answered after an event does not roll the state back", async () => {
  const { result } = renderHook(() => usePfState("a"));
  act(() => emit("a", state("new")));
  await act(async () => reply("a", state("old")));
  expect(tunnelIds(result.current)).toEqual(["new"]);
});

test("a session dropped from the list drops out of the map", async () => {
  const { result, rerender } = renderHook(({ ids }) => usePfStates(ids), { initialProps: { ids: ["a", "b"] } });
  await act(async () => {
    reply("a", state("a1"));
    reply("b", state("b1"));
  });
  rerender({ ids: ["b"] });
  expect([...result.current.keys()]).toEqual(["b"]);
});

test("a session still tracked elsewhere keeps its state when one hook lets go", async () => {
  const keeper = renderHook(() => usePfState("a"));
  const leaver = renderHook(() => usePfState("a"));
  await act(async () => reply("a", state("a1")));
  leaver.unmount();
  expect(tunnelIds(keeper.result.current)).toEqual(["a1"]);
});

test("a tracked session is re-read when it reconnects", async () => {
  sessionStore.current.setState({ sessions: [{ id: "a", status: "connected" }] });
  const { result } = renderHook(() => usePfState("a"));
  await act(async () => reply("a", state("before")));

  act(() => sessionStore.current.setState({ sessions: [{ id: "a", status: "disconnected" }] }));
  act(() => sessionStore.current.setState({ sessions: [{ id: "a", status: "connected" }] }));
  await act(async () => reply("a", state("after")));
  expect(tunnelIds(result.current)).toEqual(["after"]);
});

test("a session that stays in a changed list keeps its state without a refetch", async () => {
  const { result, rerender } = renderHook(({ ids }) => usePfStates(ids), { initialProps: { ids: ["a", "b"] } });
  await act(async () => {
    reply("a", state("a1"));
    reply("b", state("b1"));
  });
  await act(async () => rerender({ ids: ["b", "c"] }));
  expect(tunnelIds(result.current.get("b"))).toEqual(["b1"]);
  expect(h.invoke.mock.calls.map(([, args]) => args.sessionId)).toEqual(["a", "b", "c"]);
});
