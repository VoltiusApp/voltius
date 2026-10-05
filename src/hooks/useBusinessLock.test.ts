// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Team } from "@/services/teamService";

const me = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/hooks/useMyUserId", () => ({ useMyUserId: () => me.id }));

import { useTeamStore } from "@/stores/teamStore";
import { useBusinessLock } from "./useBusinessLock";

const team = (owner_tier: string, owner_id = "u1"): Team =>
  ({ id: "t1", name: "t1", owner_id, owner_tier, created_at: "", role_ids: [] });

beforeEach(() => {
  me.id = "u1";
  useTeamStore.setState({ teams: [] });
});

test("a Teams-plan team is locked", () => {
  useTeamStore.setState({ teams: [team("teams")] });
  expect(renderHook(() => useBusinessLock("t1")).result.current.locked).toBe(true);
});

test("Business and self-hosted (reported as business) are unlocked", () => {
  useTeamStore.setState({ teams: [team("business")] });
  expect(renderHook(() => useBusinessLock("t1")).result.current.locked).toBe(false);
});

test("an unknown team or a just-created row with no tier yet is not locked", () => {
  expect(renderHook(() => useBusinessLock("t1")).result.current.locked).toBe(false);
  useTeamStore.setState({ teams: [team("")] });
  expect(renderHook(() => useBusinessLock("t1")).result.current.locked).toBe(false);
  expect(renderHook(() => useBusinessLock(null)).result.current.locked).toBe(false);
});

test("isOwner is the team's owner_id, and null while the user id is unknown", () => {
  useTeamStore.setState({ teams: [team("teams", "u1")] });
  expect(renderHook(() => useBusinessLock("t1")).result.current.isOwner).toBe(true);
  useTeamStore.setState({ teams: [team("teams", "someone-else")] });
  expect(renderHook(() => useBusinessLock("t1")).result.current.isOwner).toBe(false);
  me.id = "";
  useTeamStore.setState({ teams: [team("teams", "")] });
  expect(renderHook(() => useBusinessLock("t1")).result.current.isOwner).toBeNull();
});
