import { PERM_BITS, hasBuiltinRole as realHasBuiltinRole, type Permission } from "@/services/permissions";

const SMALL_BITS: Partial<Record<Permission, number>> = { MANAGE_MEMBERS: 1, MANAGE_ROLES: 2, INVITE_MEMBERS: 4 };

/** Stand-in for `@/hooks/usePermission` where the subject holds `bits()`, with MEMBERS/ROLES/INVITE as bits 1/2/4. */
export function memberPermissions(
  bits: () => number,
  options: { subject?: string; hasBuiltinRole?: (...args: never[]) => boolean } = {},
) {
  const can = (permission: Permission) => (bits() & (SMALL_BITS[permission] ?? PERM_BITS[permission])) !== 0;
  return {
    PERM_BITS,
    hasBuiltinRole: options.hasBuiltinRole ?? realHasBuiltinRole,
    usePermissions: () => can,
    usePermissionSubjectId: () => options.subject ?? "me",
    useHeldPermissionBits: bits,
  };
}
