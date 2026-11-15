// @vitest-environment jsdom
import { expect, test, vi } from "vitest";

vi.mock("@/stores/folderStore", () => ({ useFolderStore: () => ({}) }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: () => false }));

import { vaultPickHandler } from "./vaultObjectForm";

test("an existing object saves its pending edits, then changes vault through the move flow", () => {
  const order: string[] = [];
  const pick = vi.fn();
  const changed = vaultPickHandler({
    existing: true,
    flush: () => order.push("flush"),
    onMoveToVault: (id) => order.push(`move:${id}`),
    pick,
  })("team-1");
  expect(order).toEqual(["flush", "move:team-1"]);
  expect(changed).toBe(false);
  expect(pick).not.toHaveBeenCalled();
});

test("a new object only picks its vault", () => {
  const onMoveToVault = vi.fn();
  const pick = vi.fn();
  expect(vaultPickHandler({ existing: false, onMoveToVault, pick })("team-1")).toBe(true);
  expect(pick).toHaveBeenCalledWith("team-1");
  expect(onMoveToVault).not.toHaveBeenCalled();
});
