import type { Connection, ConnectionFormData, Identity, IdentityFormData, SshKey, SshKeyFormData } from "@/types";
import type { VaultClipboardKind } from "@/stores/vaultClipboardStore";
import type { CascadeEntry } from "@/services/vaultClipboard";
import { getSecret, storeSecret } from "@/services/vault";
import {
  publishKeySecrets,
  unpublishKeySecrets,
  publishIdentitySecrets,
  unpublishIdentitySecrets,
  transferConnectionSecrets,
} from "@/services/vaultSecrets";
import { connectionToFormData } from "@/stores/connectionStore";
import { nameIsFree } from "@/utils/cloneName";
import type { ClipboardHalf } from "./types";

type KeyFormData = SshKeyFormData;

export interface ConnectionsClipboardDeps {
  connections: Connection[];
  keys: SshKey[];
  identities: Identity[];
  getConnectionsInFolderTree: (folderId: string) => Connection[];
  vaultForFolder: (folderId: string | null) => string | null;
  updateConnection: (id: string, form: ConnectionFormData) => Promise<unknown>;
  deleteConnection: (id: string) => Promise<unknown>;
  loadConnections: () => Promise<unknown>;
  moveObjectsToFolder: (
    ids: string[], objectType: "connection", folderId: string | null,
  ) => Promise<unknown>;
  duplicateInto: (
    conn: Connection, folderId: string | null,
    opts: { vaultId?: string; keepName: boolean; identityId?: string; keyId?: string },
  ) => Promise<{ id: string } | null>;
  updateKey: (id: string, form: KeyFormData) => Promise<unknown>;
  saveKey: (form: KeyFormData) => Promise<{ id: string }>;
  updateIdentity: (id: string, form: IdentityFormData) => Promise<unknown>;
  saveIdentity: (form: IdentityFormData) => Promise<{ id: string }>;
  withdrawOrWarn: (p: Promise<unknown>) => Promise<unknown>;
}

// ── Paste cascade: the key/identity a pasted host needs in the destination ──

/**
 * A host's key and identity are its plumbing, so a paste carries them along
 * rather than refusing over them. `applyCascade` runs before the paste writes
 * anything and records what it created here; `duplicateItems`/`moveItems` then
 * point the pasted hosts at the destination's copies instead of the originals.
 * Cleared per paste — a stale entry would repoint a later paste at the wrong key.
 *
 * Must outlive a single `connectionsClipboardHalf(...)` call: `usePageClipboard`
 * dereferences the adapter through a ref rather than the render-time closure, so a
 * store write during `applyCascade` (it saves/updates keys and identities) can
 * trigger a re-render — and a fresh factory call — before the paste reaches
 * `duplicateItems`/`moveItems`. A remap created inside the factory would be thrown
 * away by that re-render; the caller must own and persist it instead.
 */
export function connectionsClipboardHalf(
  deps: ConnectionsClipboardDeps,
  cascadeRemap: { identities: Map<string, string>; keys: Map<string, string> } = {
    identities: new Map(),
    keys: new Map(),
  },
): ClipboardHalf {
  /**
   * A pasted host's links, pointed at the destination's copies where the cascade
   * made one. Absent from the map means the object moved instead, keeping its id.
   */
  const remappedLinks = (conn: Connection): { identityId?: string; keyId?: string } => ({
    identityId: conn.identity_id
      ? cascadeRemap.identities.get(conn.identity_id) ?? conn.identity_id
      : undefined,
    keyId: conn.key_id ? cascadeRemap.keys.get(conn.key_id) ?? conn.key_id : undefined,
  });

  /** Hosts a paste writes, from the selected items and every folder subtree in it. */
  const pastedConnections = (
    items: { id: string; kind: VaultClipboardKind }[],
    folderIds: string[],
  ): Connection[] => [
    ...items.map((i) => deps.connections.find((c) => c.id === i.id)).filter((c) => !!c),
    ...folderIds.flatMap((id) => deps.getConnectionsInFolderTree(id)),
  ];

  /**
   * The key and identity objects a paste has to bring into `destination`, and
   * whether each can move or must be copied. An object still referenced from
   * outside the paste is copied: its material lives per-vault, so moving it would
   * leave whatever stayed behind pointing at something it cannot read.
   */
  const cascadeFor = (
    items: { id: string; kind: VaultClipboardKind }[],
    folderIds: string[],
    destination: string,
    mode: "copy" | "cut",
  ): { entries: CascadeEntry[]; identities: Identity[]; keys: SshKey[] } => {
    const moved = pastedConnections(items, folderIds);
    const movedIds = new Set(moved.map((c) => c.id));

    const travellingIdentities = [
      ...new Map(
        moved
          .map((c) => (c.identity_id ? deps.identities.find((i) => i.id === c.identity_id) : undefined))
          .filter((i) => !!i)
          .filter((i) => (i.vault_id ?? "personal") !== destination)
          .map((i) => [i.id, i] as const),
      ).values(),
    ];
    const travellingKeys = [
      ...new Map(
        [...moved.map((c) => c.key_id), ...travellingIdentities.map((i) => i.key_id)]
          .map((keyId) => (keyId ? deps.keys.find((k) => k.id === keyId) : undefined))
          .filter((k) => !!k)
          .filter((k) => (k.vault_id ?? "personal") !== destination)
          .map((k) => [k.id, k] as const),
      ).values(),
    ];

    // A copy empties nothing, so nothing it references may move either.
    const heldByHostStayingBehind = (usesIt: (c: Connection) => boolean) =>
      deps.connections.some((c) => !movedIds.has(c.id) && usesIt(c));
    const travellingIdentity = (id: string) => travellingIdentities.some((i) => i.id === id);
    const action = (shared: boolean): "move" | "copy" =>
      mode === "copy" || shared ? "copy" : "move";

    const entries: CascadeEntry[] = [
      ...travellingKeys.map((k) => ({
        type: "key" as const,
        // default name kept in English until all creation sites are localized together (see i18n issue #14)
        label: k.name ?? "Unnamed key",
        sourceVaultId: k.vault_id ?? "personal",
        // A key is also held by any identity that is not itself travelling.
        action: action(
          heldByHostStayingBehind((c) => c.key_id === k.id)
          || deps.identities.some((i) => i.key_id === k.id && !travellingIdentity(i.id)),
        ),
      })),
      ...travellingIdentities.map((i) => ({
        type: "identity" as const,
        label: i.name || i.username,
        sourceVaultId: i.vault_id ?? "personal",
        action: action(heldByHostStayingBehind((c) => c.identity_id === i.id)),
      })),
    ];
    return { entries, identities: travellingIdentities, keys: travellingKeys };
  };

  return {
    folderContentKinds: (folderId): VaultClipboardKind[] =>
      deps.getConnectionsInFolderTree(folderId).length > 0 ? ["connection"] : [],
    planCascade: (items, folderIds, destination, mode) =>
      cascadeFor(items, folderIds, destination, mode).entries,
    /**
     * Brings the referenced key/identity into the destination before the paste
     * writes anything, so the hosts it creates can point at them. A shared object
     * is copied rather than moved — see `cascadeFor`.
     */
    applyCascade: async (items, folderIds, destination, mode) => {
      cascadeRemap.identities = new Map();
      cascadeRemap.keys = new Map();
      const plan = cascadeFor(items, folderIds, destination, mode);
      const actionOf = (type: "key" | "identity", label: string) =>
        plan.entries.find((e) => e.type === type && e.label === label)?.action ?? "copy";

      for (const key of plan.keys) {
        const from = key.vault_id ?? "personal";
        if (actionOf("key", key.name ?? "Unnamed key") === "move") {
          await deps.updateKey(key.id, {
            name: key.name, key_type: key.key_type, tags: key.tags,
            folder_id: key.folder_id, vault_id: destination,
          });
          await publishKeySecrets(key.id, destination);
          await deps.withdrawOrWarn(unpublishKeySecrets(key.id, from));
          continue;
        }
        const created = await deps.saveKey({
          name: key.name, key_type: key.key_type, tags: key.tags, vault_id: destination,
        });
        const [priv, pub] = await Promise.all([
          getSecret(`key:${key.id}:private`).catch(() => null),
          getSecret(`key:${key.id}:public`).catch(() => null),
        ]);
        if (priv) await storeSecret(`key:${created.id}:private`, priv);
        if (pub) await storeSecret(`key:${created.id}:public`, pub);
        await publishKeySecrets(created.id, destination);
        cascadeRemap.keys.set(key.id, created.id);
      }

      for (const identity of plan.identities) {
        const from = identity.vault_id ?? "personal";
        // Its key travelled first, so the identity follows whichever copy landed.
        const keyId = identity.key_id
          ? cascadeRemap.keys.get(identity.key_id) ?? identity.key_id
          : undefined;
        if (actionOf("identity", identity.name || identity.username) === "move") {
          await deps.updateIdentity(identity.id, {
            name: identity.name, username: identity.username, key_id: keyId,
            tags: identity.tags, folder_id: identity.folder_id, vault_id: destination,
          });
          await publishIdentitySecrets(identity.id, destination);
          await deps.withdrawOrWarn(unpublishIdentitySecrets(identity.id, from));
          continue;
        }
        const created = await deps.saveIdentity({
          name: identity.name, username: identity.username, key_id: keyId,
          tags: identity.tags, vault_id: destination,
        });
        const pwd = await getSecret(`identity:${identity.id}:password`).catch(() => null);
        if (pwd) await storeSecret(`identity:${created.id}:password`, pwd);
        await publishIdentitySecrets(created.id, destination);
        cascadeRemap.identities.set(identity.id, created.id);
      }
    },
    // Still reported so a paste the cascade cannot resolve refuses rather than
    // completing with a reference dangling outside the destination.
    danglingKinds: (items, folderIds, destination): VaultClipboardKind[] => {
      const moved = [
        ...items.map((i) => deps.connections.find((c) => c.id === i.id)).filter((c) => !!c),
        ...folderIds.flatMap((id) => deps.getConnectionsInFolderTree(id)),
      ];
      if (moved.length === 0) return [];
      const kinds: VaultClipboardKind[] = [];
      const linkedIdentities = moved
        .map((c) => c.identity_id && deps.identities.find((i) => i.id === c.identity_id))
        .filter((i) => !!i);
      if (linkedIdentities.some((i) => (i.vault_id ?? "personal") !== destination)) {
        kinds.push("identity");
      }
      const linkedKeys = [...moved.map((c) => c.key_id), ...linkedIdentities.map((i) => i.key_id)]
        .map((keyId) => keyId && deps.keys.find((k) => k.id === keyId))
        .filter((k) => !!k);
      if (linkedKeys.some((k) => (k.vault_id ?? "personal") !== destination)) kinds.push("key");
      return kinds;
    },
    // A same-vault move only rewrites folder_id; a cross-vault one has to go through
    // updateConnection so the object actually changes vault, otherwise it would keep
    // a stale vault_id alongside its new folder's.
    moveItems: async (ids, folderId, vaultId) => {
      const sameVault: string[] = [];
      for (const id of ids) {
        const conn = deps.connections.find((c) => c.id === id);
        if (!conn) continue;
        if (vaultId === null || (conn.vault_id ?? "personal") === vaultId) {
          sameVault.push(id);
          continue;
        }
        const from = conn.vault_id ?? "personal";
        const links = remappedLinks(conn);
        await deps.updateConnection(id, {
          ...connectionToFormData(conn),
          identity_id: links.identityId,
          key_id: links.keyId,
          folder_id: folderId ?? undefined,
          vault_id: vaultId,
        });
        await transferConnectionSecrets(id, from, vaultId);
      }
      // moveObjectsToFolder writes through to the DB without touching the connection
      // store, so the reload is what makes the paste visible — as in `onDropToFolder`.
      if (sameVault.length > 0) {
        await deps.moveObjectsToFolder(sameVault, "connection", folderId);
        await deps.loadConnections();
      }
    },
    duplicateItems: async (ids, folderId) => {
      const targetVault = deps.vaultForFolder(folderId);
      const created: string[] = [];
      for (const id of ids) {
        const conn = deps.connections.find((c) => c.id === id);
        if (!conn) continue;
        const dup = await deps.duplicateInto(conn, folderId, {
          vaultId: targetVault ?? undefined,
          keepName: nameIsFree(deps.connections, conn.name, targetVault ?? conn.vault_id ?? "personal", folderId),
          ...remappedLinks(conn),
        });
        if (dup) created.push(dup.id);
      }
      return created;
    },
    deleteItems: async (ids) => { for (const id of ids) await deps.deleteConnection(id); },
  };
}
