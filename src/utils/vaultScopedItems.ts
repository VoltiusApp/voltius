type VaultScopedItem = { vault_id?: string };

interface SelectVaultScopedItemsOptions<T extends VaultScopedItem> {
  vaultId: string;
  localItems: T[];
  teamItems: Record<string, T[]>;
  teamVaultIds: Set<string>;
  resolveVaultId?: (vaultId: string) => string;
}

export function selectVaultScopedItems<T extends VaultScopedItem>({
  vaultId,
  localItems,
  teamItems,
  teamVaultIds,
  resolveVaultId = (id) => id,
}: SelectVaultScopedItemsOptions<T>): T[] {
  const currentVaultId = vaultId || "personal";
  if (currentVaultId === "personal") {
    return localItems.filter((item) => !item.vault_id || item.vault_id === "personal");
  }

  const resolvedVaultId = resolveVaultId(currentVaultId);
  if (teamVaultIds.has(resolvedVaultId) || Object.prototype.hasOwnProperty.call(teamItems, resolvedVaultId)) {
    return teamItems[resolvedVaultId] ?? [];
  }

  return localItems.filter((item) => item.vault_id === resolvedVaultId || item.vault_id === currentVaultId);
}
