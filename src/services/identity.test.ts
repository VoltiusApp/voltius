import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  vaultKey: [5, 5, 5] as number[] | null,
  myUserId: "me" as string | null,
  published: null as string | null,
  cas: true,
  fetch: vi.fn(),
  store: {} as Record<string, string>,
  seq: [] as string[],
  rosterGate: undefined as Promise<void> | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/vault", () => ({ getVaultKey: () => h.vaultKey }));
vi.mock("@/services/teamService", () => ({
  getMyUserId: async () => h.myUserId,
  getUserPublicKey: async () => {
    h.seq.push("roster");
    await h.rosterGate;
    return h.published ? { public_key: h.published } : null;
  },
}));
vi.mock("@/services/serverCapabilities", () => ({ serverSupportsWrappedSecretsCas: async () => h.cas }));
vi.mock("@/services/authTokens", () => ({ getServerUrl: async () => "https://srv" }));
vi.mock("@/services/authFetch", () => ({ fetchAuthJson: h.fetch }));

import { clearIdentityCache, ensureIdentity } from "./identity";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";

const KEK = [9, 9, 9];
const DEK = [1, 1, 1];
const STORED = [2, 2, 2];
// A derived pair is named after its seed; a stored private key's public key is "PUB_OF_<bytes>".
const derivedPub = (seed: number[]) => `DERIVED_FROM_${seed}`;

beforeEach(() => {
  clearIdentityCache();
  useVaultKeysStore.getState().clear();
  h.vaultKey = [5, 5, 5];
  h.myUserId = "me";
  h.published = null;
  h.cas = true;
  h.store = { wrapped_user_secrets: "OLD_WRAPPED" };
  h.seq = [];
  h.rosterGate = undefined;
  h.fetch.mockReset();
  h.fetch.mockImplementation(async (url: string, init: { body: string }) => {
    h.seq.push(`PUT ${url}`);
    return { ok: true, status: 204, body: JSON.parse(init.body) };
  });
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    switch (cmd) {
      case "derive_x25519_keypair":
        return { public_key: derivedPub(args.encKey as number[]), private_key: btoa(`priv-${args.encKey}`) };
      case "x25519_public_from_private":
        return `PUB_OF_${args.privateKey}`;
      case "wrap_user_secrets_cmd":
        return `WRAPPED(${args.x25519Private})`;
      case "keychain_get":
        h.seq.push(`read ${args.key}`);
        return h.store[args.key as string] ?? null;
      case "keychain_set":
        h.store[args.key as string] = args.value as string;
        return undefined;
      default:
        return undefined;
    }
  });
});

const cloudSession = () => useVaultKeysStore.getState().set({ kek: KEK, dek: DEK, x25519Private: STORED });
const bytes = (b64: string) => Array.from(atob(b64), (c) => c.charCodeAt(0));
const sentBody = () => JSON.parse(h.fetch.mock.calls[0][1].body);

test("a stored identity the roster agrees with is used as is", async () => {
  cloudSession();
  h.published = `PUB_OF_${STORED}`;
  const id = await ensureIdentity();
  expect(id).toMatchObject({ publicKey: `PUB_OF_${STORED}`, proven: true, stored: true });
  expect(h.fetch).not.toHaveBeenCalled();
});

test("a cloud account's random stored key is replaced by the dek-derived identity it published", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  const id = await ensureIdentity();
  expect(id).toMatchObject({ publicKey: derivedPub(DEK), proven: true, stored: true });
  expect(sentBody()).toEqual({
    wrapped_user_secrets: `WRAPPED(${bytes(btoa(`priv-${DEK}`))})`,
    expected_wrapped_user_secrets: "OLD_WRAPPED",
  });
  expect(h.store.wrapped_user_secrets).toBe(`WRAPPED(${bytes(btoa(`priv-${DEK}`))})`);
  expect(useVaultKeysStore.getState().x25519Private).toEqual(bytes(btoa(`priv-${DEK}`)));
});

test("a linked account's dek device finds the identity its kek published", async () => {
  cloudSession();
  h.vaultKey = DEK;
  h.published = derivedPub(KEK);
  const id = await ensureIdentity();
  expect(id).toMatchObject({ publicKey: derivedPub(KEK), proven: true, stored: true });
  expect(useVaultKeysStore.getState().identityUnproven).toBe(false);
});

test("no candidate matching the roster leaves the session unproven and writes nothing", async () => {
  cloudSession();
  h.published = "SOMEONE_ELSE";
  const id = await ensureIdentity();
  expect(id).toMatchObject({ proven: false, stored: false });
  expect(useVaultKeysStore.getState().identityUnproven).toBe(true);
  expect(h.fetch).not.toHaveBeenCalled();
});

test("a server without compare-and-swap gets no write; the identity still holds for the session", async () => {
  cloudSession();
  h.cas = false;
  h.published = derivedPub(DEK);
  expect(await ensureIdentity()).toMatchObject({ publicKey: derivedPub(DEK), proven: true, stored: false });
  expect(h.fetch).not.toHaveBeenCalled();
  expect(h.store.wrapped_user_secrets).toBe("OLD_WRAPPED");
});

test("a 409 leaves the keychain and the store as they were", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  h.fetch.mockResolvedValue({ ok: false, status: 409 });
  expect(await ensureIdentity()).toMatchObject({ proven: true, stored: false });
  expect(h.store.wrapped_user_secrets).toBe("OLD_WRAPPED");
  expect(useVaultKeysStore.getState().x25519Private).toEqual(STORED);
});

test("the expected value is captured before the roster fetch", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  await ensureIdentity();
  expect(h.seq.indexOf("read wrapped_user_secrets")).toBeLessThan(h.seq.indexOf("roster"));
});

test("a local session derives from its vault key without asking the server", async () => {
  const id = await ensureIdentity();
  expect(id).toMatchObject({ publicKey: derivedPub([5, 5, 5]), proven: false, stored: false });
  expect(h.seq).not.toContain("roster");
});

test("the lookup runs once per session", async () => {
  cloudSession();
  h.published = `PUB_OF_${STORED}`;
  await ensureIdentity();
  await ensureIdentity();
  expect(h.seq.filter((s) => s === "roster")).toHaveLength(1);

  clearIdentityCache();
  h.myUserId = null;
  await expect(ensureIdentity()).resolves.toMatchObject({ proven: false });
});

test("a locked vault has no identity", async () => {
  h.vaultKey = null;
  await expect(ensureIdentity()).rejects.toThrow("common.error.vaultLocked");
});

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
};
const switchAccount = () => {
  h.vaultKey = [7, 7, 7];
  useVaultKeysStore.getState().set({ kek: [8, 8, 8], dek: [4, 4, 4], x25519Private: [3, 3, 3] });
};

test("an account switch during the roster fetch leaves the new session alone", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  const gate = deferred();
  h.rosterGate = gate.promise;
  const pending = ensureIdentity();
  await vi.waitFor(() => expect(h.seq).toContain("roster"));
  switchAccount();
  gate.release();
  await expect(pending).resolves.toMatchObject({ proven: false, stored: false });
  expect(useVaultKeysStore.getState().identityUnproven).toBe(false);
  expect(h.fetch).not.toHaveBeenCalled();
  expect(h.store.wrapped_user_secrets).toBe("OLD_WRAPPED");
});

test("an account switch during the PUT writes nothing locally", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  h.fetch.mockImplementation(async () => {
    switchAccount();
    return { ok: true, status: 204 };
  });
  await expect(ensureIdentity()).resolves.toMatchObject({ proven: true, stored: false });
  expect(h.store.wrapped_user_secrets).toBe("OLD_WRAPPED");
  expect(useVaultKeysStore.getState().x25519Private).toEqual([3, 3, 3]);
});

test("a rejected PUT leaves a proven identity unstored and writes nothing", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  h.fetch.mockRejectedValue(new Error("offline"));
  await expect(ensureIdentity()).resolves.toMatchObject({ proven: true, stored: false });
  expect(h.store.wrapped_user_secrets).toBe("OLD_WRAPPED");
  expect(useVaultKeysStore.getState().x25519Private).toEqual(STORED);
});

test("no stored wrapped secrets means no write", async () => {
  cloudSession();
  h.store = {};
  h.published = derivedPub(DEK);
  await expect(ensureIdentity()).resolves.toMatchObject({ proven: true, stored: false });
  expect(h.fetch).not.toHaveBeenCalled();
});

const dekPrivate = () => bytes(btoa(`priv-${DEK}`));

test("an unpublished roster and a stored dek identity need no write", async () => {
  useVaultKeysStore.getState().set({ kek: KEK, dek: DEK, x25519Private: dekPrivate() });
  await expect(ensureIdentity()).resolves.toMatchObject({ publicKey: derivedPub(DEK), proven: true, stored: true });
  expect(h.fetch).not.toHaveBeenCalled();
});

test.each([
  ["another stored key", STORED],
  ["no stored key", null],
])("an unpublished roster with %s stores the dek identity", async (_name, x25519Private) => {
  useVaultKeysStore.setState({ kek: KEK, dek: DEK, x25519Private });
  await expect(ensureIdentity()).resolves.toMatchObject({ publicKey: derivedPub(DEK), proven: true, stored: true });
  expect(sentBody()).toEqual({
    wrapped_user_secrets: `WRAPPED(${dekPrivate()})`,
    expected_wrapped_user_secrets: "OLD_WRAPPED",
  });
  expect(useVaultKeysStore.getState().x25519Private).toEqual(dekPrivate());
});

test("a stored key that is not a valid private key is passed over", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  const impl = h.invoke.getMockImplementation()!;
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "x25519_public_from_private") throw new Error("not 32 bytes");
    return impl(cmd, args);
  });
  await expect(ensureIdentity()).resolves.toMatchObject({ publicKey: derivedPub(DEK), proven: true, stored: true });
});

test("an account switch during the keychain write leaves the new session's keys alone", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  const impl = h.invoke.getMockImplementation()!;
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    const r = await impl(cmd, args);
    if (cmd === "keychain_set") switchAccount();
    return r;
  });
  await expect(ensureIdentity()).resolves.toMatchObject({ proven: true, stored: true });
  expect(useVaultKeysStore.getState().x25519Private).toEqual([3, 3, 3]);
});

test("a wrap failure still resolves a proven identity", async () => {
  cloudSession();
  h.published = derivedPub(DEK);
  const impl = h.invoke.getMockImplementation()!;
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "wrap_user_secrets_cmd") throw new Error("wrap");
    return impl(cmd, args);
  });
  await expect(ensureIdentity()).resolves.toMatchObject({ proven: true, stored: false });
  expect(h.fetch).not.toHaveBeenCalled();
});
