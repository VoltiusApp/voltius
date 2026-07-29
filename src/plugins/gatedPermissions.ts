/**
 * Permissions that require explicit, danger-styled user consent at install.
 * Enforcement is upstream at the consent surface (describePermissions + the
 * install/update dialog), NOT by load provenance — a plugin holds a gated perm
 * when the user knowingly consented to it. The runtime `requireGated` only
 * verifies the manifest declared it. The list names which strings are gated;
 * expected to grow over time.
 */
export const GATED_PERMISSIONS = new Set<string>([
  "terminal:read",
  "terminal:stream",
  "keychain:read",
  "keychain:write",
]);

export function isGatedPermission(perm: string): boolean {
  return GATED_PERMISSIONS.has(perm);
}

export function visiblePermissions(perms: string[]): string[] {
  return perms.filter((p) => !isGatedPermission(p));
}
