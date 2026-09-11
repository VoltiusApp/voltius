import { describe, it, expect, vi, beforeEach } from "vitest";
import { PERM_BITS } from "@/services/permissions";

const invoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/teamService", () => ({ listRoles: vi.fn() }));

describe("cacheVaultRoles", () => {
  beforeEach(() => invoke.mockClear());

  it("writes role bits minus the caller's denied bits", async () => {
    const { cacheVaultRoles } = await import("@/stores/teamStore");
    await cacheVaultRoles(
      [{
        id: "t1", name: "T", owner_id: "u1", owner_tier: "pro", created_at: "",
        role_ids: ["r1"], permission_allow: 0, permission_deny: PERM_BITS.EDIT_CONNECTIONS,
      }] as never,
      { t1: [{ id: "r1", team_id: "t1", name: "editor", permissions: PERM_BITS.EDIT_CONNECTIONS | PERM_BITS.CONNECT, is_builtin: true, position: 2, created_at: "" }] },
      () => {},
    );

    const written = JSON.parse(invoke.mock.calls[0][1].value as string);
    expect(written.t1).toBe(PERM_BITS.CONNECT);
  });

  it("writes role bits plus the caller's allowed bits", async () => {
    const { cacheVaultRoles } = await import("@/stores/teamStore");
    await cacheVaultRoles(
      [{
        id: "t1", name: "T", owner_id: "u1", owner_tier: "pro", created_at: "",
        role_ids: ["r1"], permission_allow: PERM_BITS.EDIT_KEYS, permission_deny: 0,
      }] as never,
      { t1: [{ id: "r1", team_id: "t1", name: "connect", permissions: PERM_BITS.CONNECT, is_builtin: true, position: 4, created_at: "" }] },
      () => {},
    );

    const written = JSON.parse(invoke.mock.calls[0][1].value as string);
    expect(written.t1).toBe(PERM_BITS.CONNECT | PERM_BITS.EDIT_KEYS);
  });
});
