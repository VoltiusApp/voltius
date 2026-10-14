import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import { getVaultKey } from "@/services/vault";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";
import * as teamService from "@/services/teamService";
import { fetchAuthJson } from "@/services/authFetch";
import { getServerUrl } from "@/services/authTokens";
import { serverSupportsWrappedSecretsCas } from "@/services/serverCapabilities";
import { base64ToBytes, bytesToBase64 } from "@/utils/base64";

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
  const r = await invoke<{ public_key: string; private_key: string }>("derive_x25519_keypair", { encKey: seed });
  return { privateKey: r.private_key, publicKey: r.public_key };
}

async function fromPrivate(privateKey: number[]): Promise<Keypair> {
  const publicKey = await invoke<string>("x25519_public_from_private", { privateKey });
  return { privateKey: bytesToBase64(privateKey), publicKey };
}

async function store(keys: { kek: number[]; dek: number[] }, identity: Keypair, expected: string | null): Promise<boolean> {
  const serverUrl = await getServerUrl();
  if (!serverUrl || !(await serverSupportsWrappedSecretsCas())) return false;
  const x25519Private = Array.from(base64ToBytes(identity.privateKey));
  const next = await invoke<string>("wrap_user_secrets_cmd", { ...keys, x25519Private });
  const res = await fetchAuthJson(`${serverUrl}/v1/auth/wrapped-user-secrets`, {
    method: "PUT",
    body: JSON.stringify({ wrapped_user_secrets: next, expected_wrapped_user_secrets: expected }),
  }).catch(() => null);
  if (!res?.ok) return false;
  await invoke("keychain_set", { key: "wrapped_user_secrets", value: next });
  useVaultKeysStore.getState().set({ ...keys, x25519Private });
  return true;
}

async function resolve(vaultKey: number[], { kek, dek, x25519Private }: SessionKeys): Promise<Identity> {
  const unproven = async (): Promise<Identity> => ({ ...(await derive(vaultKey)), proven: false, stored: false });
  if (!kek || !dek) return unproven();
  // Read before the roster: a lookup outliving an account switch must fail the server's compare-and-swap.
  const expected = await invoke<string | null>("keychain_get", { key: "wrapped_user_secrets" });
  const myUserId = await teamService.getMyUserId();
  if (!myUserId) return unproven();
  const published = (await teamService.getUserPublicKey(myUserId))?.public_key ?? null;

  if (x25519Private) {
    const stored = await fromPrivate(x25519Private);
    if (stored.publicKey === published) return { ...stored, proven: true, stored: true };
  }
  const candidates = await Promise.all([vaultKey, kek, dek].map(derive));
  const match = published ? candidates.find((c) => c.publicKey === published) : candidates[0];
  if (!match) {
    useVaultKeysStore.getState().markIdentityUnproven();
    return unproven();
  }
  return { ...match, proven: true, stored: await store({ kek, dek }, match, expected) };
}

/** The account's X25519 identity, resolved once per vault key and stored keypair. */
export function ensureIdentity(): Promise<Identity> {
  const vaultKey = getVaultKey();
  if (!vaultKey) return Promise.reject(new Error(i18n.t("common.error.vaultLocked")));
  const keys = useVaultKeysStore.getState();
  if (memo && memo.vaultKey === vaultKey && memo.x25519Private === keys.x25519Private) return memo.identity;
  const identity = resolve(vaultKey, keys);
  memo = { vaultKey, x25519Private: keys.x25519Private, identity };
  identity.catch(() => {
    if (memo?.identity === identity) memo = null;
  });
  return identity;
}
