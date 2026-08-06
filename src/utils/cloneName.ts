/**
 * Whether a clone should keep its original name or take the "(copy)" suffix.
 *
 * The suffix only earns its place where the name would actually collide. Pasting
 * into another vault is the common case where it does not: the original is not
 * there, so the clone is just the object, not a copy of anything visible.
 *
 * Shared by all four object tabs — the rule is the same whether the thing being
 * cloned is a host, key, identity, rule, snippet or folder.
 */

interface Placed {
  name?: string;
  vault_id?: string;
}

const sameVault = (x: Placed, vaultId: string) => (x.vault_id ?? "personal") === vaultId;

/** An unnamed object cannot collide, so it always keeps what it has. */
export function nameIsFree(
  siblings: (Placed & { folder_id?: string | null })[],
  name: string | undefined,
  vaultId: string,
  folderId: string | null,
): boolean {
  if (!name) return true;
  return !siblings.some(
    (x) => x.name === name && sameVault(x, vaultId) && (x.folder_id ?? null) === folderId,
  );
}

export function folderNameIsFree(
  folders: (Placed & { parent_folder_id?: string | null })[],
  name: string | undefined,
  vaultId: string,
  parentFolderId: string | null,
): boolean {
  if (!name) return true;
  return !folders.some(
    (f) =>
      f.name === name && sameVault(f, vaultId) && (f.parent_folder_id ?? null) === parentFolderId,
  );
}
