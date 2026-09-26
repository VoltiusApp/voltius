import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PfSessionState } from "@/services/portForwardingTunnels";
import type { ActiveTunnel } from "@/types";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));

import { usePfState, usePfStates } from "./usePfStates";

const state = (...ids: string[]): PfSessionState => ({
  tunnels: ids.map((id) => ({ id }) as ActiveTunnel),
  suppressed_ports: [],
});
const tunnelIds = (s: PfSessionState | undefined) => s?.tunnels.map((t) => t.id);

/** A pf_get_state reply per session, released by the test. */
let replies: Map<string, (s: PfSessionState) => void>;
let emit: (sessionId: string, s: PfSessionState) => void;
let unlisten: ReturnType<typeof vi.fn>;
let releaseListen: () => void;

beforeEach(() => {
  replies = new Map();
  unlisten = vi.fn();
  h.invoke.mockReset().mockImplementation((_cmd: string, { sessionId }: { sessionId: string }) =>
    new Promise((resolve) => replies.set(sessionId, resolve)),
  );
  h.listen.mockReset().mockImplementation((_event: string, cb: (e: { payload: unknown }) => void) => {
    emit = (sessionId, s) => cb({ payload: { session_id: sessionId, ...s } });
    return new Promise((resolve) => { releaseListen = () => resolve(unlisten); });
  });
});
afterEach(() => cleanup());

test("a fetch for the previous session does not paint over the new one", async () => {
  const { result, rerender } = renderHook(({ id }) => usePfState(id), { initialProps: { id: "a" } });
  rerender({ id: "b" });
  await act(async () => replies.get("a")!(state("a-tunnel")));
  expect(result.current).toBeUndefined();

  await act(async () => replies.get("b")!(state("b-tunnel")));
  expect(tunnelIds(result.current)).toEqual(["b-tunnel"]);
});

test("a listener that registers after unmount is removed, not leaked", async () => {
  const { unmount } = renderHook(() => usePfStates(["a"]));
  unmount();
  expect(unlisten).not.toHaveBeenCalled();
  await act(async () => releaseListen());
  expect(unlisten).toHaveBeenCalledTimes(1);
});

test("events keep each tracked session current and ignore the rest", async () => {
  const { result } = renderHook(() => usePfStates(["a", "b"]));
  await act(async () => {
    replies.get("a")!(state("a1"));
    replies.get("b")!(state("b1"));
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
  await act(async () => replies.get("a")!(state("old")));
  expect(tunnelIds(result.current)).toEqual(["new"]);
});

test("a session dropped from the list drops out of the map", async () => {
  const { result, rerender } = renderHook(({ ids }) => usePfStates(ids), { initialProps: { ids: ["a", "b"] } });
  await act(async () => {
    replies.get("a")!(state("a1"));
    replies.get("b")!(state("b1"));
  });
  rerender({ ids: ["b"] });
  expect([...result.current.keys()]).toEqual(["b"]);
});
