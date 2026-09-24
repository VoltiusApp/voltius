import type { Vault } from "@/stores/vaultStore";

export const PERSONAL_VAULT: Vault = { id: "personal", name: "Personal" };

/** The store always holds "personal"; bare vault lists passed in may not. */
export function vaultById(vaults: Vault[], id: string): Vault | undefined {
  return vaults.find((v) => v.id === id) ?? (id === PERSONAL_VAULT.id ? PERSONAL_VAULT : undefined);
}

export function withPersonalFirst(vaults: Vault[]): Vault[] {
  return [vaultById(vaults, PERSONAL_VAULT.id)!, ...vaults.filter((v) => v.id !== PERSONAL_VAULT.id)];
}
