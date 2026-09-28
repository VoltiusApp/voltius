import { test, expect, vi, beforeEach } from "vitest";
import type { Connection, Identity, SshKey } from "@/types";

const h = vi.hoisted(() => ({
  teamOf: (v: string | null | undefined) => (v?.startsWith("team") ? v : null),
  moveTo: async (_id: string, data: { vault_id?: string | null }) => {
    h.events.push("update");
    h.location.vault = data.vault_id ?? h.location.vault;
  },
  at: (teamId: string, k: string) => `${teamId}/${k}`,
  events: [] as string[],
  unavailable: {} as Record<string, boolean>,
  local: new Map<string, string>(),
  team: new Map<string, string>(),
  queued: new Set<string>(),
  location: { vault: "personal" },
  teamUploadFails: true,
  addToast: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/services/secretRouting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/secretRouting")>();
  const write = async (teamId: string | null, k: string, v: string) => {
    h.events.push(`write ${teamId} ${k}`);
    if (!teamId) return void h.local.set(k, v);
    h.team.set(h.at(teamId, k), v);
    if (h.teamUploadFails) throw new actual.TeamSecretUploadError(k, new Error("503"));
  };
  const remove = async (teamId: string | null, k: string) => void (teamId ? h.team.delete(h.at(teamId, k)) : h.local.delete(k));
  h.write.mockImplementation(write);
  h.remove.mockImplementation(remove);
  return {
    ...actual,
    teamIdOfVault: h.teamOf,
    readSecretAt: async (teamId: string | null, k: string) => (teamId ? h.team.get(h.at(teamId, k)) : h.local.get(k)) ?? null,
    writeSecretAt: (...a: Parameters<typeof write>) => h.write(...a),
    removeSecretAt: (...a: Parameters<typeof remove>) => h.remove(...a),
  };
});
vi.mock("@/services/vault", () => ({
  storeSecret: (k: string, v: string) => h.write(h.teamOf(h.location.vault), k, v),
  deleteSecret: (k: string) => h.remove(h.teamOf(h.location.vault), k),
  getSecret: vi.fn(),
}));
vi.mock("@/stores/connectionStore", () => ({ useConnectionStore: { getState: () => ({ updateConnection: h.moveTo }) } }));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: { getState: () => ({ updateKey: h.moveTo }) } }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: { getState: () => ({ updateIdentity: h.moveTo }) } }));
vi.mock("@/stores/pendingTeamSecretUploadStore", () => ({
  usePendingTeamSecretUploadStore: { getState: () => ({
    enqueue: (_t: string, keys: string[]) => keys.forEach((k) => h.queued.add(k)),
    resolve: (_t: string, keys: string[]) => keys.forEach((k) => h.queued.delete(k)),
  }) },
}));
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: { getState: () => ({ credentialsUnavailableByTeamId: h.unavailable }) },
}));
vi.mock("@/stores/notificationStore", () => ({ useNotificationStore: { getState: () => ({ addToast: h.addToast }) } }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/lib/logger", () => ({ logFailure: () => () => {} }));

import { saveHostFromForm } from "./hostForm";
import { saveKeyFromForm, saveIdentityFromForm } from "./keychainForm";

const TEAM = "team-1";
const none = { password: null, privateKey: null, passphrase: null, proxyPassword: null };

const editors = [
  {
    kind: "host", key: "password:c1",
    save: (vault_id: string, value: string, from = "personal") =>
      saveHostFromForm({ id: "c1", vault_id: from } as Connection, { tags: [], vault_id }, { ...none, password: value }, "personal"),
  },
  {
    kind: "key", key: "key:k1:private",
    save: (vault_id: string, value: string, from = "personal") =>
      saveKeyFromForm({ id: "k1", vault_id: from } as SshKey, { tags: [], vault_id }, value, null, null, "personal"),
  },
  {
    kind: "identity", key: "identity:i1:password",
    save: (vault_id: string, value: string, from = "personal") =>
      saveIdentityFromForm({ id: "i1", vault_id: from } as Identity, { vault_id } as never, value, undefined, { current: null }, "personal"),
  },
];

beforeEach(() => {
  h.local.clear();
  h.team.clear();
  h.queued.clear();
  h.events.length = 0;
  h.unavailable = {};
  h.location.vault = "personal";
  h.teamUploadFails = true;
  h.addToast.mockReset();
  h.write.mockClear();
  h.remove.mockClear();
});

test.each(editors)("a $kind moved into a team with both uploads failing keeps the EDITED value queued", async ({ key, save }) => {
  h.local.set(key, "old");

  await save(TEAM, "new").catch(() => {});

  expect(h.local.get(key)).toBe("new");
  expect(h.queued).toContain(key);
  expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ message: "common.error.secretsUploadPending" }));
});

test.each(editors)("a $kind moved into a team uploads the edited value, not the old one", async ({ key, save }) => {
  h.teamUploadFails = false;
  h.local.set(key, "old");

  await save(TEAM, "new");

  expect(h.team.get(h.at(TEAM, key))).toBe("new");
  expect(h.local.has(key)).toBe(false);
  expect(h.queued).not.toContain(key);
  expect(h.write.mock.calls.filter(([t]) => t === TEAM)).toEqual([[TEAM, key, "new"]]);
});

test.each(editors)("clearing a $kind field during a move deletes it at the source before the move", async ({ key, save }) => {
  h.local.set(key, "old");

  await save(TEAM, "");

  expect(h.local.has(key)).toBe(false);
  expect(h.team.has(h.at(TEAM, key))).toBe(false);
  expect(h.queued).not.toContain(key);
  expect(h.write).not.toHaveBeenCalled();
});

test.each(editors)("a same-vault $kind edit writes once, after the update, where the object lives", async ({ key, save }) => {
  h.local.set(key, "old");

  await save("personal", "new");

  expect(h.local.get(key)).toBe("new");
  expect(h.events).toEqual(["update", `write null ${key}`]);
  expect(h.queued.size).toBe(0);
});

const fromTeam = (key: string, from: string) => {
  h.team.set(h.at(from, key), "old");
  h.location.vault = from;
};

test.each(editors)("a $kind leaving a team whose credentials are unavailable keeps the edit at its destination", async ({ key, save }) => {
  fromTeam(key, TEAM);
  h.unavailable = { [TEAM]: true };

  await save("personal", "new", TEAM);

  expect(h.local.get(key)).toBe("new");
  expect(h.events.indexOf("update")).toBeLessThan(h.events.indexOf(`write null ${key}`));
});

test.each(editors)("a $kind leaving a team carries the edited value when the source upload succeeds", async ({ key, save }) => {
  fromTeam(key, TEAM);
  h.teamUploadFails = false;

  await save("personal", "new", TEAM);

  expect(h.local.get(key)).toBe("new");
  expect(h.team.has(h.at(TEAM, key))).toBe(false);
});

test.each(editors)("a $kind leaving a team carries the edited value when the source upload fails", async ({ key, save }) => {
  fromTeam(key, TEAM);

  await save("personal", "new", TEAM);

  expect(h.local.get(key)).toBe("new");
  expect(h.team.has(h.at(TEAM, key))).toBe(false);
});

test.each(editors)("a $kind moved between teams with every upload failing queues the edited value", async ({ key, save }) => {
  fromTeam(key, TEAM);

  await save("team-2", "new", TEAM).catch(() => {});

  expect(h.local.get(key)).toBe("new");
  expect(h.queued).toContain(key);
});
