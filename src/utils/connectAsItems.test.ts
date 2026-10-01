import { test, expect, vi } from "vitest";
import { buildConnectAsItems } from "./connectAsItems";

const t = ((k: string, o?: Record<string, string>) => (o ? `${k}:${o.vault}` : k)) as never;
const own = { id: "own", username: "alice", name: "Alice (laptop key)" };
const team = { id: "team", username: "deploy", name: "ops-root" };

test("lists choices, the host default, then the vault default", () => {
  const onPick = vi.fn();
  const onOpen = vi.fn();
  const items = buildConnectAsItems({ choices: [own, team], current: { kind: "pick", id: "own" }, isOwn: (id: string) => id === "own", hostLabel: "ops-deploy", hasPick: false, vaultName: "Ops", t, onPick, onOpenVaultDefault: onOpen });

  expect(items.map((i) => [i.label, i.icon, i.hint])).toEqual([
    ["Alice (laptop key)", "lucide:check", "hosts.connectAs.yours"],
    ["ops-root", "lucide:key-round", undefined],
    ["ops-deploy", "lucide:server", "hosts.connectAs.hostDefault"],
    ["hosts.connectAs.vaultDefault:Ops", "lucide:user-round-cog", undefined],
  ]);
  items[1].onClick?.();
  expect(onPick).toHaveBeenLastCalledWith("team");
  items[2].onClick?.();
  expect(onPick).toHaveBeenLastCalledWith(null);
  items[3].onClick?.();
  expect(onOpen).toHaveBeenCalled();
});

test("without a pick the host default is checked; without a shared credential it is absent", () => {
  const items = buildConnectAsItems({ choices: [own], current: { kind: "host" }, isOwn: (id: string) => id === "own", hostLabel: "ops-deploy", hasPick: false, vaultName: "Ops", t, onPick: vi.fn(), onOpenVaultDefault: vi.fn() });
  expect(items[1].icon).toBe("lucide:check");
  const bare = buildConnectAsItems({ choices: [own], current: { kind: "host" }, isOwn: (id: string) => id === "own", hostLabel: null, hasPick: false, vaultName: "Ops", t, onPick: vi.fn(), onOpenVaultDefault: vi.fn() });
  expect(bare.map((i) => i.label)).toEqual(["Alice (laptop key)", "hosts.connectAs.vaultDefault:Ops"]);
});

test("an unavailable choice checks nothing", () => {
  const items = buildConnectAsItems({ choices: [own], current: { kind: "none" }, isOwn: (id: string) => id === "own", hostLabel: "ops-deploy", hasPick: false, vaultName: "Ops", t, onPick: vi.fn(), onOpenVaultDefault: vi.fn() });
  expect(items.map((i) => i.icon)).not.toContain("lucide:check");
});

test("a pick on a host without a shared credential can be cleared", () => {
  const onPick = vi.fn();
  const items = buildConnectAsItems({ choices: [own], current: { kind: "none" }, isOwn: (id: string) => id === "own", hostLabel: null, hasPick: true, vaultName: "Ops", t, onPick, onOpenVaultDefault: vi.fn() });
  expect(items.map((i) => i.label)).toEqual(["Alice (laptop key)", "hosts.connectAs.clearPick", "hosts.connectAs.vaultDefault:Ops"]);
  items[1].onClick?.();
  expect(onPick).toHaveBeenLastCalledWith(null);
});

test("with a shared credential the host default already clears the pick", () => {
  const items = buildConnectAsItems({ choices: [own], current: { kind: "pick", id: "own" }, isOwn: (id: string) => id === "own", hostLabel: "ops-deploy", hasPick: true, vaultName: "Ops", t, onPick: vi.fn(), onOpenVaultDefault: vi.fn() });
  expect(items.map((i) => i.label)).not.toContain("hosts.connectAs.clearPick");
});

test("the host's own identity is listed once, as the host default", () => {
  const items = buildConnectAsItems({ choices: [own, team], current: { kind: "host" }, isOwn: (id: string) => id === "own", hostLabel: "ops-root", hostIdentityId: "team", hasPick: false, vaultName: "Ops", t, onPick: vi.fn(), onOpenVaultDefault: vi.fn() });
  expect(items.map((i) => [i.label, i.icon])).toEqual([
    ["Alice (laptop key)", "lucide:user-round"],
    ["ops-root", "lucide:check"],
    ["hosts.connectAs.vaultDefault:Ops", "lucide:user-round-cog"],
  ]);
});

test("a pick of the host's own identity checks the host default", () => {
  const items = buildConnectAsItems({ choices: [own, team], current: { kind: "pick", id: "team" }, isOwn: (id: string) => id === "own", hostLabel: "ops-root", hostIdentityId: "team", hasPick: true, vaultName: "Ops", t, onPick: vi.fn(), onOpenVaultDefault: vi.fn() });
  expect(items.filter((i) => i.icon === "lucide:check").map((i) => i.label)).toEqual(["ops-root"]);
});
