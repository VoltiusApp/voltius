import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import { logFailure } from "@/lib/logger";
import { deriveX25519Keypair, wrapUserSecrets } from "@/services/crypto/identityKeys";
import { getVaultKey } from "@/services/vault";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";
import * as teamService from "@/services/teamService";
import { fetchAuthJson } from "@/services/authFetch";
import { getServerUrl } from "@/services/authTokens";
import { serverSupportsWrappedSecretsCas } from "@/services/serverCapabilities";
import { base64ToByteArray, bytesToBase64 } from "@/utils/base64";

export interface Identity {
  privateKey: string;
  publicKey: string;
  /** Its public key is the roster's, or the roster has none yet. */
  proven: boolean;
  /** The account's wrapped secrets carry it, so no device needs a vault key to find it again. */
  stored: boolean;
}

interface Keypair {
  privateKey: string;
  publicKey: string;
}

type SessionKeys = { kek: number[] | null; dek: number[] | null; x25519Private: number[] | null };

let memo: { vaultKey: number[]; x25519Private: number[] | null; identity: Promise<Identity> } | null = null;

export function clearIdentityCache(): void {
  memo = null;
}

async function derive(seed: number[]): Promise<Keypair> {
  const r = await deriveX25519Keypair(seed);
  return { privateKey: r.private_key, publicKey: r.public_key };
}

async function fromPrivate(privateKey: number[]): Promise<Keypair> {
  const publicKey = await invoke<string>("x25519_public_from_private", { privateKey });
  return { privateKey: bytesToBase64(privateKey), publicKey };
}

async function store(
  keys: { kek: number[]; dek: number[] },
  identity: Keypair,
  expected: string | null,
  stillCurrent: () => boolean,
): Promise<boolean> {
  if (!expected || !stillCurrent()) return false;
  const serverUrl = await getServerUrl();
  if (!serverUrl || !(await serverSupportsWrappedSecretsCas())) return false;
  const x25519Private = base64ToByteArray(identity.privateKey);
  const next = await wrapUserSecrets(keys.kek, keys.dek, x25519Private);
  const res = await fetchAuthJson(`${serverUrl}/v1/auth/wrapped-user-secrets`, {
    method: "PUT",
    body: JSON.stringify({ wrapped_user_secrets: next, expected_wrapped_user_secrets: expected }),
  }).catch((e) => {
    logFailure("identity: store wrapped secrets")(e);
    return null;
  });
  if (!res) return false;
  if (!res.ok) {
    logFailure("identity: store wrapped secrets")(new Error(`status ${res.status}`));
    return false;
  }
  if (!stillCurrent()) return false;
  await invoke("keychain_set", { key: "wrapped_user_secrets", value: next });
  if (stillCurrent()) useVaultKeysStore.getState().set({ ...keys, x25519Private });
  return true;
}

async function resolve(
  vaultKey: number[],
  { kek, dek, x25519Private }: SessionKeys,
  flags: { noUser: boolean },
): Promise<Identity> {
  const unproven = async (): Promise<Identity> => ({ ...(await derive(vaultKey)), proven: false, stored: false });
  if (!kek || !dek) return unproven();
  const stillCurrent = () => getVaultKey() === vaultKey && useVaultKeysStore.getState().kek === kek;
  // Read before the roster: a lookup outliving an account switch must fail the server's compare-and-swap.
  const expected = await invoke<string | null>("keychain_get", { key: "wrapped_user_secrets" });
  const myUserId = await teamService.getMyUserId();
  if (!myUserId) {
    flags.noUser = true;
    return unproven();
  }
  const published = (await teamService.getUserPublicKey(myUserId))?.public_key ?? null;
  if (!stillCurrent()) return unproven();

  const held = x25519Private ? await fromPrivate(x25519Private).catch(() => null) : null;
  if (held && held.publicKey === published) return { ...held, proven: true, stored: true };
  const candidates = await Promise.all([vaultKey, kek, dek].map(derive));
  const fromDek = candidates[2];
  if (!published && held?.privateKey === fromDek.privateKey) return { ...fromDek, proven: true, stored: true };
  const match = published ? candidates.find((c) => c.publicKey === published) : fromDek;
  if (!match) {
    if (stillCurrent()) useVaultKeysStore.getState().markIdentityUnproven();
    return unproven();
  }
  const stored = await store({ kek, dek }, match, expected, stillCurrent).catch((e) => {
    logFailure("identity: store")(e);
    return false;
  });
  return { ...match, proven: true, stored };
}

/** The account's X25519 identity, resolved once per vault key and stored keypair. */
export function ensureIdentity(): Promise<Identity> {
  const vaultKey = getVaultKey();
  if (!vaultKey) return Promise.reject(new Error(i18n.t("common.error.vaultLocked")));
  const keys = useVaultKeysStore.getState();
  if (memo && memo.vaultKey === vaultKey && memo.x25519Private === keys.x25519Private) return memo.identity;
  const flags = { noUser: false };
  const identity = resolve(vaultKey, keys, flags);
  const entry = { vaultKey, x25519Private: keys.x25519Private, identity };
  memo = entry;
  const forget = () => {
    if (memo === entry) memo = null;
  };
  identity.then(() => flags.noUser && forget(), forget);
  return identity;
}
