/**
 * Permissions on the gated, first-party-only tier. Never granted to marketplace
 * plugins: denied at runtime (see runtime `requireGated`) and hidden from the
 * install-consent surface. Enforcement is by load provenance, not this list —
 * the list only names which strings are gated. Expected to grow over time
 * (e.g. plugins:install, security settings:set).
 */
export const GATED_PERMISSIONS = new Set<string>([
  "terminal:read",
  "terminal:stream",
]);

export function isGatedPermission(perm: string): boolean {
  return GATED_PERMISSIONS.has(perm);
}

export function visiblePermissions(perms: string[]): string[] {
  return perms.filter((p) => !isGatedPermission(p));
}
