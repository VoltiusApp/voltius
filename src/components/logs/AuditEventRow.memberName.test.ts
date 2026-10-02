import { test, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: { getState: () => ({ identities: [] }) } }));

import { actorName } from "@/components/logs/AuditEventRow";
import type { AuditLog } from "@/services/auditService";

const log = (over: Partial<AuditLog>): AuditLog => ({
  id: 1, team_id: "t", vault_id: null, actor_id: "u", actor_name: "swift-otter-1", action: "vault.deleted",
  source: "server", target_type: null, target_id: null, target_name: null, metadata: null, ip_address: null,
  created_at: "2026-10-02T00:00:00Z", ...over,
} as AuditLog);

test("audit actor shows the member name when the server sends one", () => {
  expect(actorName(log({ actor_member_name: "Jan Novák" }))).toBe("Jan Novák");
});

test("audit actor falls back to the handle", () => {
  expect(actorName(log({ actor_member_name: null }))).toBe("swift-otter-1");
  expect(actorName(log({}))).toBe("swift-otter-1");
});
