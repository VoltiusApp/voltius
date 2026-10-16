// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateFromPlugin, oneToOne } from "./migrate";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useTeamStore } from "@/stores/teamStore";
import * as connApi from "@/services/connections";
import * as keyApi from "@/services/keys";
import * as idApi from "@/services/identities";
import * as runtime from "@/plugins/runtime";
import * as state from "./state";

vi.mock("@/services/connections");
vi.mock("@/services/keys");
vi.mock("@/services/identities");
vi.mock("@/plugins/runtime", () => ({ pluginStorageGetStrict: vi.fn(), pluginStorageClear: vi.fn(async () => {}) }));
vi.mock("./state", () => ({ loadSshConfigState: vi.fn(), updateSshConfigState: vi.fn(async (p) => p) }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn(), getDeviceId: async () => "dev-b" }));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));

const conn = (id: string, tags: string[], extra = {}) => ({ id, name: id, host: "h", port: 22, username: "u", tags, vault_id: "personal", ...extra });
const key = (extra = {}) => ({ id: "k", name: "id", key_type: "ed25519", tags: ["ssh-config"], ...extra });
const ident = (extra = {}) => ({ id: "i", name: "a", username: "u", tags: ["ssh-config"], ...extra });

function seedDisk(c: unknown[], k: unknown[], i: unknown[]) {
  vi.mocked(connApi.listConnections).mockResolvedValue(c as never);
  vi.mocked(keyApi.listKeys).mockResolvedValue(k as never);
  vi.mocked(idApi.listIdentities).mockResolvedValue(i as never);
}

const consentOf = (value: string | null) =>
  vi.mocked(runtime.pluginStorageGetStrict).mockImplementation(async (_p, k) => (k === "import_consent" ? value : null) as never);

beforeEach(() => {
  vi.clearAllMocks();
  useConnectionStore.setState({ connections: [], teamConnections: { t1: [conn("t", ["ssh-config"])] } as never });
  useKeyStore.setState({ keys: [] });
  useIdentityStore.setState({ identities: [] });
  useMarketplaceStore.setState({ installedMeta: [], uninstallPlugin: vi.fn(async () => {}) } as never);
  usePluginRegistryStore.setState({ overrides: {}, setEnabled: vi.fn(async () => {}) } as never);
  useTeamStore.setState({ teams: [] } as never);
  seedDisk([conn("a", ["ssh-config", "prod"], { name: "Renamed" }), conn("b", [])], [key()], [ident()]);
  vi.mocked(state.loadSshConfigState).mockResolvedValue({});
});

describe("migrateFromPlugin", () => {
  it("untags personal objects from disk and keeps every other field", async () => {
    consentOf("granted");
    await migrateFromPlugin();
    expect(connApi.updateConnection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(connApi.updateConnection).mock.calls[0][1]).toMatchObject({ name: "Renamed", tags: ["prod"] });
    expect(vi.mocked(keyApi.updateKey).mock.calls[0][1]).toMatchObject({ tags: [] });
    expect(vi.mocked(idApi.updateIdentity).mock.calls[0][1]).toMatchObject({ tags: [] });
    expect(state.updateSshConfigState).toHaveBeenNthCalledWith(1, { offer: "accepted", notice: "pending" });
    expect(state.updateSshConfigState).toHaveBeenLastCalledWith({ migrated: { "dev-b": expect.any(Number) } });
    expect(runtime.pluginStorageClear).toHaveBeenCalledWith("plugin-ssh-config");
  });

  it("keeps pinned on keys and identities", async () => {
    consentOf(null);
    seedDisk([], [key({ pinned: true })], [ident({ pinned: true })]);
    await migrateFromPlugin();
    expect(vi.mocked(keyApi.updateKey).mock.calls[0][1]).toMatchObject({ pinned: true });
    expect(vi.mocked(idApi.updateIdentity).mock.calls[0][1]).toMatchObject({ pinned: true });
  });

  it("migrates from disk even when the stores are empty", async () => {
    consentOf(null);
    await migrateFromPlugin();
    expect(connApi.updateConnection).toHaveBeenCalledTimes(1);
  });

  it("carries a declined answer and shows no notice when sync was off", async () => {
    seedDisk([], [], []);
    consentOf("declined");
    await migrateFromPlugin();
    expect(state.updateSshConfigState).toHaveBeenNthCalledWith(1, { offer: "declined" });
    expect(state.updateSshConfigState).toHaveBeenLastCalledWith({ migrated: { "dev-b": expect.any(Number) } });
  });

  it("shows no notice when the user had declined, even with tagged objects", async () => {
    consentOf("declined");
    await migrateFromPlugin();
    expect(state.updateSshConfigState).toHaveBeenNthCalledWith(1, { offer: "declined" });
  });

  it("pins the old plugin off with a synced false override", async () => {
    consentOf(null);
    usePluginRegistryStore.setState({ overrides: { "plugin-ssh-config": true } });
    await migrateFromPlugin();
    expect(usePluginRegistryStore.getState().setEnabled).toHaveBeenCalledWith("plugin-ssh-config", false);
  });

  it("leaves an existing false override alone", async () => {
    consentOf(null);
    usePluginRegistryStore.setState({ overrides: { "plugin-ssh-config": false } });
    await migrateFromPlugin();
    expect(usePluginRegistryStore.getState().setEnabled).not.toHaveBeenCalled();
  });

  it("never retags team-vault objects a list returns", async () => {
    consentOf(null);
    useTeamStore.setState({ teams: [{ id: "team-1" }] } as never);
    seedDisk([conn("a", ["ssh-config"]), conn("t", ["ssh-config"], { vault_id: "team-1" })], [], []);
    await migrateFromPlugin();
    expect(vi.mocked(connApi.updateConnection).mock.calls.map(([id]) => id)).toEqual(["a"]);
  });

  it("does nothing once migrated", async () => {
    vi.mocked(state.loadSshConfigState).mockResolvedValue({ migrated: { "dev-b": 1 } });
    await migrateFromPlugin();
    expect(connApi.updateConnection).not.toHaveBeenCalled();
    expect(state.updateSshConfigState).not.toHaveBeenCalled();
  });

  it("persists the carried state before failing, never marks migrated, and re-runs cleanly", async () => {
    consentOf("granted");
    vi.mocked(connApi.updateConnection).mockRejectedValueOnce(new Error("disk"));
    await expect(migrateFromPlugin()).rejects.toThrow("disk");
    expect(state.updateSshConfigState).toHaveBeenCalledTimes(1);
    expect(state.updateSshConfigState).toHaveBeenCalledWith({ offer: "accepted", notice: "pending" });
    expect(runtime.pluginStorageClear).not.toHaveBeenCalled();
    seedDisk([conn("a", ["prod"])], [], []);
    await migrateFromPlugin();
    expect(state.updateSshConfigState).toHaveBeenLastCalledWith({ migrated: { "dev-b": expect.any(Number) } });
  });

  it("migrates from tags alone and keeps the file when the legacy storage cannot be read", async () => {
    vi.mocked(runtime.pluginStorageGetStrict).mockRejectedValue(new Error("unreadable"));
    await migrateFromPlugin();
    expect(state.updateSshConfigState).toHaveBeenNthCalledWith(1, { offer: "accepted", notice: "pending" });
    expect(connApi.updateConnection).toHaveBeenCalledTimes(1);
    expect(runtime.pluginStorageClear).not.toHaveBeenCalled();
    expect(state.updateSshConfigState).toHaveBeenLastCalledWith({ migrated: { "dev-b": expect.any(Number) } });
  });

  it("still migrates this device when another device already did", async () => {
    vi.mocked(state.loadSshConfigState).mockResolvedValue({ migrated: { "dev-a": 1 } });
    vi.mocked(runtime.pluginStorageGetStrict).mockImplementation(async (_p, k) => (k === "alias_map" ? { web: "c1" } : null) as never);
    await migrateFromPlugin();
    expect(state.updateSshConfigState).toHaveBeenCalledWith(expect.objectContaining({ legacyAliases: { web: "c1" } }));
    expect(runtime.pluginStorageClear).toHaveBeenCalledWith("plugin-ssh-config");
  });

  it("keeps one-to-one plugin aliases for the activation preview", async () => {
    vi.mocked(runtime.pluginStorageGetStrict).mockImplementation(async (_p, k) =>
      (k === "alias_map" ? { web: "c1", Oracle: "c2", TradingSim: "c2" } : null) as never,
    );
    await migrateFromPlugin();
    expect(state.updateSshConfigState).toHaveBeenCalledWith(expect.objectContaining({ legacyAliases: { web: "c1" } }));
    const saved = vi.mocked(state.updateSshConfigState).mock.invocationCallOrder[0];
    expect(saved).toBeLessThan(vi.mocked(runtime.pluginStorageClear).mock.invocationCallOrder[0]);
  });

  it("uninstalls a marketplace copy", async () => {
    consentOf(null);
    useMarketplaceStore.setState({ installedMeta: [{ id: "plugin-ssh-config" }] } as never);
    await migrateFromPlugin();
    expect(useMarketplaceStore.getState().uninstallPlugin).toHaveBeenCalledWith("plugin-ssh-config");
  });
});

describe("oneToOne", () => {
  it.each([
    [{}, {}],
    [{ a: "1", b: "2" }, { a: "1", b: "2" }],
    [{ a: "1", b: "1", c: "3" }, { c: "3" }],
  ])("oneToOne(%j) = %j", (input, out) => expect(oneToOne(input)).toEqual(out));
});
