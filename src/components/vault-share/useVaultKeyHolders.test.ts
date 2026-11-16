// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  holders: vi.fn<(teamId: string) => Promise<string[]>>(),
  grant: vi.fn<(a: { teamId: string; userId: string; label: string; publicKey: string }) => Promise<void>>(),
}));

vi.mock("@/services/teamService", () => ({ getVaultKeyHolders: h.holders }));
vi.mock("@/services/vaultShare", () => ({ grantVaultKeyToMember: h.grant }));

import { useVaultKeyHolders } from "./useVaultKeyHolders";

const ANA = { userId: "ana", label: "Ana", publicKey: "pk-ana" };

beforeEach(() => {
  h.holders.mockReset().mockResolvedValue(["me"]);
  h.grant.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

test("loads_the_holders_of_the_team", async () => {
  const { result } = renderHook(() => useVaultKeyHolders("t1"));
  expect(result.current.holders).toBeNull();
  await waitFor(() => expect(result.current.holders).toEqual(new Set(["me"])));
  expect(h.holders).toHaveBeenCalledWith("t1");
});

test("no_team_fetches_nothing", async () => {
  const { result } = renderHook(() => useVaultKeyHolders(null));
  await act(async () => { result.current.reload(); await result.current.grant(ANA); });
  expect(result.current.holders).toBeNull();
  expect(h.holders).not.toHaveBeenCalled();
  expect(h.grant).not.toHaveBeenCalled();
});

test("a_refused_list_stays_unknown", async () => {
  h.holders.mockRejectedValue(new Error("403"));
  const { result } = renderHook(() => useVaultKeyHolders("t1"));
  await act(async () => {});
  expect(result.current.holders).toBeNull();
});

test("grant_calls_the_service_then_reloads", async () => {
  const { result } = renderHook(() => useVaultKeyHolders("t1"));
  await waitFor(() => expect(result.current.holders).not.toBeNull());
  h.holders.mockResolvedValue(["me", "ana"]);
  await act(async () => { await result.current.grant(ANA); });
  expect(h.grant).toHaveBeenCalledWith({ teamId: "t1", ...ANA });
  await waitFor(() => expect(result.current.holders).toEqual(new Set(["me", "ana"])));
});

test("a_failed_grant_does_not_reload_or_throw", async () => {
  const { result } = renderHook(() => useVaultKeyHolders("t1"));
  await waitFor(() => expect(result.current.holders).not.toBeNull());
  h.grant.mockRejectedValue(new Error("no key"));
  await act(async () => { await result.current.grant(ANA); });
  expect(h.holders).toHaveBeenCalledTimes(1);
});

test("a_stale_team_answer_is_dropped", async () => {
  let resolveT1!: (ids: string[]) => void;
  h.holders.mockImplementation((teamId) =>
    teamId === "t1" ? new Promise((r) => { resolveT1 = r; }) : Promise.resolve(["t2-member"]));
  const { result, rerender } = renderHook(({ id }) => useVaultKeyHolders(id), { initialProps: { id: "t1" } });
  rerender({ id: "t2" });
  await waitFor(() => expect(result.current.holders).toEqual(new Set(["t2-member"])));
  await act(async () => resolveT1(["t1-member"]));
  expect(result.current.holders).toEqual(new Set(["t2-member"]));
});
