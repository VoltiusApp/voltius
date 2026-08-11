import type { Identity, IdentityFormData, SshKey, SshKeyFormData } from "@/types";
import type { VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { transferKeySecrets, transferIdentitySecrets } from "@/services/vaultSecrets";
import { nameIsFree } from "@/utils/cloneName";
import type { ClipboardHalf } from "./types";

type KeyFormData = SshKeyFormData;

export interface KeychainClipboardDeps {
  keys: SshKey[];
  identities: Identity[];
  keysInFolderTree: (folderId: string) => SshKey[];
  identitiesInFolderTree: (folderId: string) => Identity[];
  vaultForFolder: (folderId: string | null) => string | null;
  updateKey: (id: string, form: KeyFormData) => Promise<unknown>;
  updateIdentity: (id: string, form: IdentityFormData) => Promise<unknown>;
  moveObjectsToFolder: (
    ids: string[], objectType: "key" | "identity", folderId: string | null,
  ) => Promise<unknown>;
  loadKeys: () => Promise<unknown>;
  loadIdentities: () => Promise<unknown>;
  duplicateKeyInto: (
    key: SshKey, folderId: string | null, opts: { vaultId?: string; keepName: boolean },
  ) => Promise<{ id: string }>;
  duplicateIdentityInto: (
    identity: Identity, folderId: string | null,
    opts: { vaultId?: string; keepName: boolean; keyId?: string },
  ) => Promise<{ id: string }>;
  deleteKey: (id: string) => Promise<unknown>;
  deleteIdentity: (id: string) => Promise<unknown>;
}

export function keychainClipboardHalf(deps: KeychainClipboardDeps): ClipboardHalf {
  return {
    folderContentKinds: (folderId): VaultClipboardKind[] => {
      const kinds: VaultClipboardKind[] = [];
      if (deps.keysInFolderTree(folderId).length > 0) kinds.push("key");
      if (deps.identitiesInFolderTree(folderId).length > 0) kinds.push("identity");
      return kinds;
    },
    // A migrated identity keeps pointing at its key, which this path does not move —
    // only the vault move/copy menu cascades that, behind VaultCascadeModal. A key
    // travelling in the same paste is not dangling, so it is excluded first.
    danglingKinds: (items, folderIds, destination): VaultClipboardKind[] => {
      const movedKeyIds = new Set([
        ...items.filter((i) => i.kind === "key").map((i) => i.id),
        ...folderIds.flatMap((id) => deps.keysInFolderTree(id).map((k) => k.id)),
      ]);
      const movedIdentities = [
        ...items
          .filter((i) => i.kind === "identity")
          .map((i) => deps.identities.find((x) => x.id === i.id))
          .filter((i) => !!i),
        ...folderIds.flatMap((id) => deps.identitiesInFolderTree(id)),
      ];
      const linkedKeys = movedIdentities
        .map((i) => i.key_id && !movedKeyIds.has(i.key_id) && deps.keys.find((k) => k.id === i.key_id))
        .filter((k) => !!k);
      return linkedKeys.some((k) => (k.vault_id ?? "personal") !== destination) ? ["key"] : [];
    },
    // moveObjectsToFolder takes a single object_type, so the ids are partitioned by
    // kind. A same-vault move only rewrites folder_id; a cross-vault one has to go
    // through updateKey/updateIdentity so the object actually changes vault, otherwise
    // it would keep a stale vault_id alongside its new folder's.
    moveItems: async (ids, folderId, vaultId) => {
      const sameVaultKeys: string[] = [];
      const sameVaultIdentities: string[] = [];
      for (const id of ids) {
        const key = deps.keys.find((k) => k.id === id);
        if (key) {
          if (vaultId === null || (key.vault_id ?? "personal") === vaultId) {
            sameVaultKeys.push(id);
            continue;
          }
          await deps.updateKey(id, {
            name: key.name, key_type: key.key_type, tags: key.tags,
            folder_id: folderId ?? undefined, vault_id: vaultId,
          });
          await transferKeySecrets(id, key.vault_id ?? "personal", vaultId);
          continue;
        }
        const identity = deps.identities.find((i) => i.id === id);
        if (!identity) continue;
        if (vaultId === null || (identity.vault_id ?? "personal") === vaultId) {
          sameVaultIdentities.push(id);
          continue;
        }
        await deps.updateIdentity(id, {
          name: identity.name, username: identity.username, key_id: identity.key_id,
          tags: identity.tags, folder_id: folderId ?? undefined, vault_id: vaultId,
        });
        await transferIdentitySecrets(id, identity.vault_id ?? "personal", vaultId);
      }
      // moveObjectsToFolder writes through to the DB without touching the key/identity
      // stores, so each touched store is reloaded — as in `dropHandler`.
      if (sameVaultKeys.length > 0) {
        await deps.moveObjectsToFolder(sameVaultKeys, "key", folderId);
        await deps.loadKeys();
      }
      if (sameVaultIdentities.length > 0) {
        await deps.moveObjectsToFolder(sameVaultIdentities, "identity", folderId);
        await deps.loadIdentities();
      }
    },
    duplicateItems: async (ids, folderId) => {
      const targetVault = deps.vaultForFolder(folderId) ?? undefined;
      const created = new Map<string, string>();
      // Keys first, as in copyFolderInto: an identity cloned alongside its key must
      // point at the clone, not back at the original in the source vault.
      const keyIdMap = new Map<string, string>();
      for (const id of ids) {
        const key = deps.keys.find((k) => k.id === id);
        if (!key) continue;
        const dup = await deps.duplicateKeyInto(key, folderId, {
          vaultId: targetVault,
          keepName: nameIsFree(deps.keys, key.name, targetVault ?? key.vault_id ?? "personal", folderId),
        });
        keyIdMap.set(key.id, dup.id);
        created.set(id, dup.id);
      }
      for (const id of ids) {
        const identity = deps.identities.find((i) => i.id === id);
        if (!identity) continue;
        const dup = await deps.duplicateIdentityInto(identity, folderId, {
          vaultId: targetVault,
          keepName: nameIsFree(deps.identities, identity.name, targetVault ?? identity.vault_id ?? "personal", folderId),
          keyId: identity.key_id ? (keyIdMap.get(identity.key_id) ?? identity.key_id) : undefined,
        });
        created.set(id, dup.id);
      }
      return ids.map((id) => created.get(id)).filter((id): id is string => !!id);
    },
    // The store methods directly, not handleDeleteKey/handleDeleteIdentity: those
    // swallow the error into the banner, which would let a failed undo report success.
    deleteItems: async (ids) => {
      for (const id of ids) {
        if (deps.keys.some((k) => k.id === id)) await deps.deleteKey(id);
        else if (deps.identities.some((i) => i.id === id)) await deps.deleteIdentity(id);
      }
    },
  };
}
