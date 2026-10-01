import { test, expect, vi } from "vitest";
import { buildConnectAsItems } from "./connectAsItems";

const t = ((k: string, o?: Record<string, string>) => (o ? `${k}:${o.vault}` : k)) as never;
const own = { id: "own", username: "alice", name: "Alice (laptop key)" };
const team = { id: "team", username: "deploy", name: "ops-root" };

test("lists choices, the host default, then the vault default", () => {
  const onPick = vi.fn();
  const onOpen = vi.fn();
  const items = buildConnectAsItems({ choices: [own, team], currentPickId: "own", ownIds: new Set(["own"]), hostLabel: "ops-deploy", vaultName: "Ops", t, onPick, onOpenVaultDefault: onOpen });

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
  const items = buildConnectAsItems({ choices: [own], currentPickId: null, ownIds: new Set(["own"]), hostLabel: "ops-deploy", vaultName: "Ops", t, onPick: vi.fn(), onOpenVaultDefault: vi.fn() });
  expect(items[1].icon).toBe("lucide:check");
  const bare = buildConnectAsItems({ choices: [own], currentPickId: null, ownIds: new Set(["own"]), hostLabel: null, vaultName: "Ops", t, onPick: vi.fn(), onOpenVaultDefault: vi.fn() });
  expect(bare.map((i) => i.label)).toEqual(["Alice (laptop key)", "hosts.connectAs.vaultDefault:Ops"]);
});
