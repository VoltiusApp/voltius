import { test, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useConnectionPresence } from "./useConnectionPresence";
import { useConnectionPresenceStore } from "@/stores/connectionPresenceStore";
import { useTeamStore } from "@/stores/teamStore";
import type { Connection } from "@/types";

const conn = (id: string, vault_id?: string) => ({ id, vault_id } as unknown as Connection);

beforeEach(() => {
  useConnectionPresenceStore.setState({ usageByConnection: {}, myUserId: null } as never);
  useTeamStore.setState({ membersByTeam: {} } as never);
});

test("null when vault_id missing", () => {
  const { result } = renderHook(() => useConnectionPresence(conn("c1")));
  expect(result.current).toBeNull();
});

test('null when vault_id === "personal"', () => {
  useConnectionPresenceStore.setState({ usageByConnection: { c1: ["u1"] } } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "personal")));
  expect(result.current).toBeNull();
});

test("null when no usage entry for connection", () => {
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current).toBeNull();
});

test("null when usage empty array", () => {
  useConnectionPresenceStore.setState({ usageByConnection: { c1: [] } } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current).toBeNull();
});

test("null when only self is present", () => {
  useConnectionPresenceStore.setState({ myUserId: "me", usageByConnection: { c1: ["me"] } } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current).toBeNull();
});

test("single other user → primary set, overflow 0, handle resolved", () => {
  useConnectionPresenceStore.setState({ myUserId: "me", usageByConnection: { c1: ["me", "u1"] } } as never);
  useTeamStore.setState({ membersByTeam: { "team-1": [{ user_id: "u1", handle: "amber-lynx-4410" }] } } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current?.primary).toEqual({ id: "u1", handle: "amber-lynx-4410" });
  expect(result.current?.overflow).toBe(0);
  expect(result.current?.allHandles).toEqual(["amber-lynx-4410"]);
});

test("two others → overflow 1, order preserved (usage order, self filtered)", () => {
  useConnectionPresenceStore.setState({ myUserId: "me", usageByConnection: { c1: ["u1", "me", "u2"] } } as never);
  useTeamStore.setState({
    membersByTeam: {
      "team-1": [
        { user_id: "u1", handle: "amber-lynx-4410" },
        { user_id: "u2", handle: "brisk-otter-8823" },
      ],
    },
  } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current?.primary.id).toBe("u1");
  expect(result.current?.overflow).toBe(1);
  expect(result.current?.allHandles).toEqual(["amber-lynx-4410", "brisk-otter-8823"]);
});

test('unknown user id falls back to "Member"', () => {
  useConnectionPresenceStore.setState({ myUserId: null, usageByConnection: { c1: ["u9"] } } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current?.primary.handle).toBe("Member");
});

test("myUserId null → no self filtering (all users are others)", () => {
  useConnectionPresenceStore.setState({ myUserId: null, usageByConnection: { c1: ["me"] } } as never);
  useTeamStore.setState({ membersByTeam: { "team-1": [{ user_id: "me", handle: "merry-quartz-2597" }] } } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current).not.toBeNull();
  expect(result.current?.primary.handle).toBe("merry-quartz-2597");
});

test("cross-team dedup: first occurrence of a user_id wins", () => {
  useConnectionPresenceStore.setState({ myUserId: null, usageByConnection: { c1: ["u1"] } } as never);
  useTeamStore.setState({
    membersByTeam: {
      A: [{ user_id: "u1", handle: "first-heron-1001" }],
      B: [{ user_id: "u1", handle: "second-heron-2002" }],
    },
  } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current?.primary.handle).toBe("first-heron-1001");
});
