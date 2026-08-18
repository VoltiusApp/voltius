import { test, expect } from "vitest";
import { vaultOverviewSections } from "./vaultOverviewSections";
import type { Vault } from "@/stores/vaultStore";
import type { Connection } from "@/types";

const conn = (id: string, vault_id?: string, last_used_at: string | null = null): Connection =>
  ({ id, name: id, host: "h", port: 22, username: "u", auth_type: "password", tags: [], vault_id, last_used_at }) as unknown as Connection;

const never = () => false;

test("hosts land in their local vault", () => {
  const vaults: Vault[] = [{ id: "personal", name: "Personal" }, { id: "v1", name: "Second" }];
  const sections = vaultOverviewSections(vaults, [conn("a"), conn("b", "v1")], never);
  expect(sections.map((s) => s.totalHosts)).toEqual([1, 1]);
  expect(sections[1].hosts.map((h) => h.id)).toEqual(["b"]);
});

test("a linked team vault counts hosts filed under its team id", () => {
  const vaults: Vault[] = [{ id: "personal", name: "Personal" }, { id: "v1", name: "Shared", teamId: "t1" }];
  const sections = vaultOverviewSections(vaults, [conn("a"), conn("b", "t1")], never);
  expect(sections[1].totalHosts).toBe(1);
  expect(sections[1].hosts.map((h) => h.id)).toEqual(["b"]);
});

test("a linked team vault still counts hosts left under the local vault id", () => {
  const vaults: Vault[] = [{ id: "v1", name: "Shared", teamId: "t1" }];
  const sections = vaultOverviewSections(vaults, [conn("a", "v1"), conn("b", "t1")], never);
  expect(sections[0].totalHosts).toBe(2);
});

test("pinned hosts come first, then most recently used, capped at six", () => {
  const vaults: Vault[] = [{ id: "personal", name: "Personal" }];
  const conns = [
    conn("old", undefined, "2026-01-01"),
    conn("new", undefined, "2026-08-01"),
    conn("pin"),
    conn("f1"), conn("f2"), conn("f3"), conn("f4"),
  ];
  const sections = vaultOverviewSections(vaults, conns, (c) => c.id === "pin");
  expect(sections[0].totalHosts).toBe(7);
  expect(sections[0].hosts.map((h) => h.id).slice(0, 3)).toEqual(["pin", "new", "old"]);
  expect(sections[0].hosts).toHaveLength(6);
});
