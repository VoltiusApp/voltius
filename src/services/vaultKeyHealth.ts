import { EDIT_PERMISSION_OF, PERM_BITS } from "@/services/permissions";
import type { RotationPass, RowFailure } from "@/services/teamKeyRotation";
import type { RotationStatus, StaleItem } from "@/services/teamService";

export type VaultKeyHealthState = "upToDate" | "rotationPending" | "reencryptPending" | "attention" | "unavailable";

export type StuckReason = "orphan" | "undecryptable" | "uploadFailed" | "needsEditor" | "waiting";

export const OVERDUE_AFTER_MS = 24 * 60 * 60 * 1000;

const olderThan = (iso: string | null | undefined, now: number) => !!iso && now - Date.parse(iso) > OVERDUE_AFTER_MS;

export function passFailed(pass: RotationPass | undefined): boolean {
  return !!pass && ((pass.error !== undefined && pass.error !== "status") || pass.failures.length > 0);
}

export function vaultKeyHealth(
  status: RotationStatus | null,
  pass: RotationPass | undefined,
  now: number,
): VaultKeyHealthState {
  if (!status) return "unavailable";
  if (!status.stale && !status.draining) return "upToDate";
  const overdue = status.draining ? olderThan(status.rotated_at, now) : olderThan(status.rotation_requested_at, now);
  if (overdue || passFailed(pass)) return "attention";
  return status.draining ? "reencryptPending" : "rotationPending";
}

export function oldEpochTotal(status: RotationStatus): number | undefined {
  const c = status.old_epoch;
  return c && c.objects + c.secrets + c.blobs;
}

export function itemKey(item: Pick<StaleItem, "kind" | "object_id" | "secret_id">): string {
  return `${item.kind}:${item.secret_id ?? item.object_id ?? ""}`;
}

function failureKey(f: RowFailure): string {
  return `${f.kind}:${f.id}`;
}

export function canEditItem(item: StaleItem): boolean {
  if (item.kind === "blob" || item.orphan) return true;
  const permission = EDIT_PERMISSION_OF[item.object_type as keyof typeof EDIT_PERMISSION_OF];
  return permission !== undefined && (item.my_permissions & PERM_BITS[permission]) !== 0;
}

export function stuckReason(item: StaleItem, pass: RotationPass | undefined, unreadable: boolean): StuckReason {
  if (item.orphan) return "orphan";
  const failure = pass?.failures.find((f) => failureKey(f) === itemKey(item));
  if (unreadable || failure?.stage === "local") return "undecryptable";
  if (failure?.stage === "upload") return "uploadFailed";
  return canEditItem(item) ? "waiting" : "needsEditor";
}

export function isRemovable(item: StaleItem, reason: StuckReason): boolean {
  return item.kind !== "blob" && (reason === "orphan" || reason === "undecryptable") && canEditItem(item);
}
