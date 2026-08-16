import { describe, test, expect, beforeEach, vi } from "vitest";
import { vaultsHandler } from "./vaults";
import {
  isAliveVaultRow,
  mergeVaultSections,
  TOMBSTONE_TTL_MS,
  type VaultsSection,
} from "@/services/vaultSection";
import { useVaultStore } from "@/stores/vaultStore";

const scheduleSync = vi.fn();
vi.mock("@/services/sync", () => ({ scheduleSync: () => scheduleSync() }));

// Relative: a fixed date would eventually age past TOMBSTONE_TTL_MS and be pruned.
const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const T1 = ago(3);
const T2 = ago(2);
const T3 = ago(1);

const row = (name: string, updatedAt: string, extra: Partial<VaultsSection[string]> = {}) =>
  ({ name, updatedAt, ...extra });

const merge = mergeVaultSections;

beforeEach(() => {
  scheduleSync.mockClear();
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }], deletedVaults: {}, selectedVaultIds: ["personal"] });
});

describe("mergeVaultSections", () => {
  test("a vault present on only one side survives the merge", () => {
    const { value, updated } = merge({ a: row("A", T1) }, { b: row("B", T1) });
    expect(Object.keys(value).sort()).toEqual(["a", "b"]);
    expect(updated).toBe(true);
  });

  test("concurrent creates on two devices both survive", () => {
    const { value } = merge({ prod: row("Prod", T1) }, { staging: row("Staging", T2) });
    expect(value.prod.name).toBe("Prod");
    expect(value.staging.name).toBe("Staging");
  });

  test("the newer name wins for a vault both sides know", () => {
    const { value, updated } = merge({ a: row("Old", T1) }, { a: row("New", T2) });
    expect(value.a.name).toBe("New");
    expect(updated).toBe(true);
  });

  test("an older remote name loses and reports no change", () => {
    const { value, updated } = merge({ a: row("New", T2) }, { a: row("Old", T1) });
    expect(value.a.name).toBe("New");
    expect(updated).toBe(false);
  });

  test("equal timestamps keep local, like every other section", () => {
    const { value, updated } = merge({ a: row("Local", T1) }, { a: row("Remote", T1) });
    expect(value.a.name).toBe("Local");
    expect(updated).toBe(false);
  });

  test("a tombstone is kept, not dropped, so the deletion keeps propagating", () => {
    const { value } = merge({ a: row("A", T1) }, { a: row("A", T1, { deletedAt: T2 }) });
    expect(value.a.deletedAt).toBe(T2);
    expect(isAliveVaultRow(value.a)).toBe(false);
  });

  test("a deletion is not resurrected by the other device's live copy", () => {
    const { value } = merge({ a: row("A", T1, { deletedAt: T2 }) }, { a: row("A", T1) });
    expect(isAliveVaultRow(value.a)).toBe(false);
  });

  test("a rename newer than the delete revives the vault under the new name", () => {
    const { value } = merge({ a: row("A", T1, { deletedAt: T2 }) }, { a: row("Renamed", T3) });
    expect(isAliveVaultRow(value.a)).toBe(true);
    expect(value.a.name).toBe("Renamed");
  });

  test("a delete newer than the rename wins", () => {
    const { value } = merge({ a: row("Renamed", T1) }, { a: row("A", T1, { deletedAt: T2 }) });
    expect(isAliveVaultRow(value.a)).toBe(false);
  });

  test("teamId travels with the newer row, and unlinking clears it", () => {
    expect(merge({ a: row("A", T1) }, { a: row("A", T2, { teamId: "t1" }) }).value.a.teamId).toBe("t1");
    expect(merge({ a: row("A", T1, { teamId: "t1" }) }, { a: row("A", T2) }).value.a.teamId).toBeUndefined();
  });

  test("a missing or malformed side is treated as empty rather than throwing", () => {
    expect(merge(undefined, { a: row("A", T1) }).value.a.name).toBe("A");
    expect(merge({ a: row("A", T1) }, undefined).updated).toBe(false);
    expect(merge({}, { a: { name: "A" } }).value.a).toBeUndefined();
  });
});

describe("vaultsHandler export/import", () => {
  test("exports user-created vaults and omits the built-in personal one", () => {
    useVaultStore.getState().addVault("Prod");
    const section = vaultsHandler.export() as VaultsSection;

    expect(Object.keys(section)).toHaveLength(1);
    expect(Object.values(section)[0].name).toBe("Prod");
    expect(section.personal).toBeUndefined();
  });

  test("exports a deleted vault as a tombstone", () => {
    const vault = useVaultStore.getState().addVault("Gone");
    useVaultStore.getState().removeVault(vault.id);

    const section = vaultsHandler.export() as VaultsSection;
    expect(section[vault.id].deletedAt).toBeTruthy();
    expect(isAliveVaultRow(section[vault.id])).toBe(false);
  });

  test("importing a live row adds the vault and selects it, so its hosts are visible", async () => {
    await vaultsHandler.import({ v1: row("From Device A", T1) } satisfies VaultsSection);

    const state = useVaultStore.getState();
    expect(state.vaults.map((v) => v.id)).toEqual(["personal", "v1"]);
    expect(state.selectedVaultIds).toContain("v1");
  });

  test("importing a tombstone removes the vault and deselects it", async () => {
    useVaultStore.setState({
      vaults: [{ id: "personal", name: "Personal" }, { id: "v1", name: "Doomed", updatedAt: T1 }],
      selectedVaultIds: ["personal", "v1"],
    });

    await vaultsHandler.import({ v1: row("Doomed", T1, { deletedAt: T2 }) } satisfies VaultsSection);

    const state = useVaultStore.getState();
    expect(state.vaults.map((v) => v.id)).toEqual(["personal"]);
    expect(state.selectedVaultIds).toEqual(["personal"]);
    expect(state.deletedVaults.v1.deletedAt).toBe(T2);
  });

  test("a vault the device already has is not re-selected after the user hid it", async () => {
    useVaultStore.setState({
      vaults: [{ id: "personal", name: "Personal" }, { id: "v1", name: "Prod", updatedAt: T1 }],
      selectedVaultIds: ["personal"],
    });

    await vaultsHandler.import({ v1: row("Prod", T2) } satisfies VaultsSection);

    expect(useVaultStore.getState().selectedVaultIds).toEqual(["personal"]);
    expect(useVaultStore.getState().vaults.find((v) => v.id === "v1")?.name).toBe("Prod");
  });

  test("getTimestamp reports the newest row, tombstones included", () => {
    useVaultStore.setState({
      vaults: [{ id: "personal", name: "Personal" }, { id: "v1", name: "Prod", updatedAt: T1 }],
      deletedVaults: { v2: row("Gone", T1, { deletedAt: T3 }) },
    });

    expect(vaultsHandler.getTimestamp()).toBe(T3);
  });

  test("getTimestamp is the epoch with nothing but the personal vault", () => {
    expect(vaultsHandler.getTimestamp()).toBe(new Date(0).toISOString());
  });

  test("a tombstone past its TTL stops being exported", () => {
    const stale = new Date(Date.now() - TOMBSTONE_TTL_MS - 1000).toISOString();
    useVaultStore.setState({ deletedVaults: { old: row("Old", stale, { deletedAt: stale }) } });

    expect(vaultsHandler.export()).toEqual({});
  });
});
