import { EDIT_PERMISSION_OF, PERM_BITS } from "@/services/permissions";
import type { TeamObjectType } from "@/services/teamObjects";

export type AccessLevel = "hidden" | "view" | "connect" | "edit";

const CREDENTIAL_TYPES: ReadonlySet<TeamObjectType> = new Set(["connection", "key", "identity", "port_forwarding_rule", "folder"]);

export const isCredentialType = (type: TeamObjectType): boolean => CREDENTIAL_TYPES.has(type);

export function accessLevel(mask: number, type: TeamObjectType): AccessLevel {
  if ((mask & PERM_BITS.VIEW) === 0) return "hidden";
  if ((mask & PERM_BITS[EDIT_PERMISSION_OF[type]]) !== 0) return "edit";
  if (isCredentialType(type) && (mask & PERM_BITS.CONNECT) !== 0) return "connect";
  return "view";
}

export const hasSecrets = (mask: number): boolean => (mask & PERM_BITS.VIEW_SECRETS) !== 0;
