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
  expect(result.current?.primary).toEqual({ id: "u1", name: "@amber-lynx-4410", avatar: "amber-lynx-4410" });
  expect(result.current?.overflow).toBe(0);
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
});

test('unknown user id falls back to "Member"', () => {
  useConnectionPresenceStore.setState({ myUserId: null, usageByConnection: { c1: ["u9"] } } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current?.primary.name).toBe("Member");
});

test("myUserId null → no self filtering (all users are others)", () => {
  useConnectionPresenceStore.setState({ myUserId: null, usageByConnection: { c1: ["me"] } } as never);
  useTeamStore.setState({ membersByTeam: { "team-1": [{ user_id: "me", handle: "merry-quartz-2597" }] } } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current).not.toBeNull();
  expect(result.current?.primary.name).toBe("@merry-quartz-2597");
});

test("uses the member name from the host's own team only", () => {
  useConnectionPresenceStore.setState({ myUserId: null, usageByConnection: { c1: ["u1"] } } as never);
  useTeamStore.setState({
    membersByTeam: {
      A: [{ user_id: "u1", handle: "first-heron-1001", member_name: "Other Team Name" }],
      "team-1": [{ user_id: "u1", handle: "first-heron-1001", member_name: "Jan" }],
    },
  } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current?.primary.name).toBe("Jan");
});

test("a member name is the label and the avatar string, without an @", () => {
  useConnectionPresenceStore.setState({ myUserId: null, usageByConnection: { c1: ["u1"] } } as never);
  useTeamStore.setState({
    membersByTeam: { "team-1": [{ user_id: "u1", handle: "jnovak", member_name: "Jan Novák" }] },
  } as never);
  const { result } = renderHook(() => useConnectionPresence(conn("c1", "team-1")));
  expect(result.current?.primary).toEqual({ id: "u1", name: "Jan Novák", avatar: "Jan Novák" });
});
