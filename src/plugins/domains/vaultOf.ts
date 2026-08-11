/**
 * The vault an object is in. An object with no `vault_id` sits in Personal,
 * matching the vault filters everywhere else in the app — a record written
 * before vaults existed has none, and reading that as "no vault" hides it from
 * every listing that groups by one.
 */
export const vaultOf = (o: { vault_id?: string | null }): string => o.vault_id ?? "personal";
