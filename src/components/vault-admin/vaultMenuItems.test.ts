import { test, expect, vi } from "vitest";
import { vaultMenuItems } from "./vaultMenuItems";
import type { VaultAdminCapabilities } from "./vaultAdminTarget";

const t = (k: string) => k;
const labels = (caps: VaultAdminCapabilities, memberCount: number | null = null) =>
  vaultMenuItems({ caps, memberCount, t, on: vi.fn() }).map((i) => i.label);

const privateCaps: VaultAdminCapabilities =
  { isTeam: false, isOwner: false, canRename: true, canDelete: true, canMakePrivate: false };
const ownerCaps: VaultAdminCapabilities =
  { isTeam: true, isOwner: true, canRename: true, canDelete: true, canMakePrivate: true };
const memberCaps: VaultAdminCapabilities =
  { isTeam: true, isOwner: false, canRename: true, canDelete: true, canMakePrivate: false };
const cloudCaps: VaultAdminCapabilities =
  { isTeam: true, isOwner: true, canRename: false, canDelete: false, canMakePrivate: false };

test("a private vault gets no members, roles or make-private entries", () => {
  expect(labels(privateCaps)).toEqual([
    "layout.vaultMenu.share",
    "layout.vaultMenu.rename",
    "layout.vaultMenu.settings",
    "layout.vaultMenu.delete",
  ]);
});

test("a team vault owner gets the full menu, destructive last", () => {
  expect(labels(ownerCaps, 4)).toEqual([
    "layout.vaultMenu.share",
    "layout.vaultMenu.members",
    "layout.vaultMenu.roles",
    "layout.vaultMenu.rename",
    "layout.vaultMenu.settings",
    "layout.vaultMenu.makePrivate",
    "layout.vaultMenu.delete",
  ]);
});

test("a team member sees members and roles but not make-private", () => {
  expect(labels(memberCaps, 4)).not.toContain("layout.vaultMenu.makePrivate");
  expect(labels(memberCaps, 4)).toContain("layout.vaultMenu.members");
});

test("a standalone team vault offers neither rename nor delete", () => {
  expect(labels(cloudCaps, 2)).toEqual([
    "layout.vaultMenu.share",
    "layout.vaultMenu.members",
    "layout.vaultMenu.roles",
  ]);
});

test("the member count rides on the Members row as a shortcut hint", () => {
  const items = vaultMenuItems({ caps: ownerCaps, memberCount: 4, t, on: vi.fn() });
  expect(items.find((i) => i.label === "layout.vaultMenu.members")?.shortcut).toBe("4");
  const none = vaultMenuItems({ caps: ownerCaps, memberCount: null, t, on: vi.fn() });
  expect(none.find((i) => i.label === "layout.vaultMenu.members")?.shortcut).toBeUndefined();
});

test("delete and make-private are flagged danger and start a divider group", () => {
  const items = vaultMenuItems({ caps: ownerCaps, memberCount: 4, t, on: vi.fn() });
  const del = items.find((i) => i.label === "layout.vaultMenu.delete")!;
  const priv = items.find((i) => i.label === "layout.vaultMenu.makePrivate")!;
  expect(del.danger).toBe(true);
  expect(priv.divider).toBe(true);
  expect(del.divider).toBe(false);
});

test("with no make-private, delete opens the destructive group itself", () => {
  const items = vaultMenuItems({ caps: privateCaps, memberCount: null, t, on: vi.fn() });
  const del = items.find((i) => i.label === "layout.vaultMenu.delete")!;
  expect(del.divider).toBe(true);
  expect(del.danger).toBe(true);
});

test("clicking an item reports its action", () => {
  const on = vi.fn();
  const items = vaultMenuItems({ caps: ownerCaps, memberCount: 4, t, on });
  items.find((i) => i.label === "layout.vaultMenu.rename")!.onClick!();
  expect(on).toHaveBeenCalledWith("rename");
});
