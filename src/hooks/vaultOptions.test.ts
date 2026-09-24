import { test, expect } from "vitest";
import { vaultOptionsFrom } from "./useVaultOptions";

test("a personal vault turned into a team vault is offered under its team id", () => {
  expect(vaultOptionsFrom([{ id: "personal", name: "Personal", teamId: "t1" }, { id: "v1", name: "Prod" }])).toEqual([
    { id: "t1", name: "Personal" },
    { id: "v1", name: "Prod" },
  ]);
});

test("only teams no local vault links to are listed after the vaults", () => {
  const vaults = [{ id: "personal", name: "Personal", teamId: "t1" }];
  expect(vaultOptionsFrom(vaults, [{ id: "t1", name: "Personal" }, { id: "t2", name: "Ops" }])).toEqual([
    { id: "t1", name: "Personal" },
    { id: "t2", name: "Ops" },
  ]);
});
