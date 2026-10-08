import { test, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string, o?: object) => (o ? `${k}:${JSON.stringify(o)}` : k) } }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: { getState: () => ({ identities: [] }) } }));

import { actorName, actorTitle, ACTION_META } from "@/components/logs/AuditEventRow";
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

test("actor tooltip adds the handle only when a member name is shown", () => {
  expect(actorTitle(log({ actor_member_name: "Jan" }))).toBe("Jan (@swift-otter-1)");
  expect(actorTitle(log({}))).toBe("swift-otter-1");
});

test("rename label reads differently when the name was cleared", () => {
  const rename = (metadata: Record<string, unknown>) => ACTION_META["member.renamed"].label(log({ action: "member.renamed", target_name: "bob", metadata }));
  expect(rename({ old: null, new: "Jan" })).toBe('logs.eventLabels.memberRenamed:{"name":"bob","to":"Jan"}');
  expect(rename({ old: "Jan", new: null })).toBe('logs.eventLabels.memberNameRemoved:{"name":"bob"}');
});

test("lock policy label names the timeout and whether Lock vault is required", () => {
  const set = (metadata: Record<string, unknown>) => ACTION_META["team.lock_policy_set"].label(log({ action: "team.lock_policy_set", metadata }));
  expect(set({ max_minutes: 15, force_vault: false }))
    .toBe('logs.eventLabels.lockPolicySet:{"timeout":"settings.account.sessionSecurity.timeout.15min"}');
  expect(set({ max_minutes: 0, force_vault: true }))
    .toBe('logs.eventLabels.lockPolicySetVault:{"timeout":"settings.account.sessionSecurity.timeout.immediately"}');
});
