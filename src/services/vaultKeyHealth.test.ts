import { describe, expect, test } from "vitest";
import { PERM_BITS } from "@/services/permissions";
import type { RotationPass } from "@/services/teamKeyRotation";
import type { RotationStatus, StaleItem } from "@/services/teamService";
import { OVERDUE_AFTER_MS, isRemovable, stuckReason, vaultKeyHealth } from "./vaultKeyHealth";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const status = (s: Partial<RotationStatus>): RotationStatus => ({ stale: false, draining: false, ...s });
const pass = (p: Partial<RotationPass>): RotationPass => ({ at: NOW, action: "none", failures: [], skipped: 0, ...p });
const object = (s: Partial<StaleItem> = {}): StaleItem => ({
  kind: "object", object_id: "c1", secret_id: null, object_type: "connection", key_version: 1, orphan: false,
  my_permissions: PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS, ...s,
});

describe("vaultKeyHealth", () => {
  test("no status is unavailable", () => {
    expect(vaultKeyHealth(null, undefined, NOW)).toBe("unavailable");
  });

  test("neither stale nor draining is up to date, even after a failed pass", () => {
    expect(vaultKeyHealth(status({}), pass({ error: "drain" }), NOW)).toBe("upToDate");
  });

  test("stale alone is a pending rotation", () => {
    expect(vaultKeyHealth(status({ stale: true, rotation_requested_at: ago(60_000) }), undefined, NOW)).toBe("rotationPending");
  });

  test("draining wins over stale, matching the order the pass runs them", () => {
    expect(vaultKeyHealth(status({ stale: true, draining: true, rotated_at: ago(60_000) }), undefined, NOW)).toBe("reencryptPending");
  });

  test("a rotation requested more than a day ago needs attention", () => {
    expect(vaultKeyHealth(status({ stale: true, rotation_requested_at: ago(OVERDUE_AFTER_MS + 1) }), undefined, NOW)).toBe("attention");
  });

  test("a drain still running a day after the key changed needs attention", () => {
    expect(vaultKeyHealth(status({ draining: true, rotated_at: ago(OVERDUE_AFTER_MS + 1) }), undefined, NOW)).toBe("attention");
  });

  test("a pass with a failed row needs attention", () => {
    const failed = pass({ failures: [{ kind: "secret", id: "s1", stage: "local" }] });
    expect(vaultKeyHealth(status({ draining: true }), failed, NOW)).toBe("attention");
  });

  test("a pass that only could not read the status does not flag attention", () => {
    expect(vaultKeyHealth(status({ stale: true }), pass({ error: "status" }), NOW)).toBe("rotationPending");
  });

  test("an older server without the extra fields still maps to a state", () => {
    expect(vaultKeyHealth({ stale: false, draining: true }, undefined, NOW)).toBe("reencryptPending");
  });
});

describe("stuckReason", () => {
  test("an orphan secret is removable", () => {
    const item = object({ kind: "secret", secret_id: "s1", object_type: null, orphan: true, my_permissions: 0 });
    expect(stuckReason(item, undefined, false)).toBe("orphan");
    expect(isRemovable(item, "orphan")).toBe(true);
  });

  test("a row this device failed to decrypt is removable by an editor", () => {
    const failed = pass({ failures: [{ kind: "object", id: "c1", stage: "local" }] });
    expect(stuckReason(object(), failed, false)).toBe("undecryptable");
    expect(isRemovable(object(), "undecryptable")).toBe(true);
  });

  test("a row that failed to decode for its name counts as undecryptable", () => {
    expect(stuckReason(object(), undefined, true)).toBe("undecryptable");
  });

  test("an upload failure is not removable", () => {
    const failed = pass({ failures: [{ kind: "object", id: "c1", stage: "upload" }] });
    expect(stuckReason(object(), failed, false)).toBe("uploadFailed");
    expect(isRemovable(object(), "uploadFailed")).toBe(false);
  });

  test("a row without the edit bit for its type needs an editor and cannot be removed", () => {
    const item = object({ my_permissions: PERM_BITS.VIEW });
    expect(stuckReason(item, undefined, false)).toBe("needsEditor");
    expect(isRemovable(item, "undecryptable")).toBe(false);
  });

  test("a failure for a secret does not mark the object with the same id", () => {
    const failed = pass({ failures: [{ kind: "secret", id: "c1", stage: "local" }] });
    expect(stuckReason(object(), failed, false)).toBe("waiting");
  });

  test("the legacy blob is never removable", () => {
    const blob = object({ kind: "blob", object_id: null, object_type: null });
    expect(isRemovable(blob, "undecryptable")).toBe(false);
  });
});
