import { test, expect, vi, beforeEach, describe } from "vitest";

const h = vi.hoisted(() => ({ serverFetch: vi.fn(), loadTeams: vi.fn() }));
vi.mock("@/services/teamService", () => ({ serverFetch: h.serverFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ loadTeams: h.loadTeams }) } }));

import {
  previewPermissions, losesVaultKey, PreviewSubjectGoneError,
  type PreviewResponse, type Preview,
} from "./permissionPreview";

const preview = (gate: boolean): Preview => ({ team_bits: 0, objects: {}, rule_sets: {}, holds_vault_key_gate: gate });
const response = (current: boolean, draft: boolean | null): PreviewResponse => ({
  locked: false, current: preview(current), draft: draft === null ? null : preview(draft), affected: null,
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });
const sentBody = () => JSON.parse(h.serverFetch.mock.calls[0][1].body);

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
});

describe("previewPermissions", () => {
  test("sends_member_subject_and_omits_absent_draft", async () => {
    h.serverFetch.mockResolvedValue(ok(response(true, null)));
    await previewPermissions("t1", { subject: { type: "member", user_id: "u1" } });
    const [path, init] = h.serverFetch.mock.calls[0];
    expect(path).toBe("/v1/teams/t1/permissions/preview");
    expect(init.method).toBe("POST");
    expect(sentBody()).toEqual({ subject: { type: "member", user_id: "u1" } });
    expect(Object.keys(sentBody())).toEqual(["subject"]);
  });

  test("maps_402_to_plan_required", async () => {
    h.serverFetch.mockResolvedValue(fail(402));
    await expect(previewPermissions("t1", { subject: { type: "role", role_id: "r1" }, scope: "full" }))
      .rejects.toMatchObject({ code: 402 });
  });

  test("a_404_throws_subject_gone", async () => {
    h.serverFetch.mockResolvedValue(fail(404));
    const err = await previewPermissions("t1", { subject: { type: "member", user_id: "u1" } }).catch((e) => e);
    expect(err).toBeInstanceOf(PreviewSubjectGoneError);
    expect(err.message).toBe("members.viewAs.ended");
  });

  test("403 and other statuses throw plain errors", async () => {
    h.serverFetch.mockResolvedValue(fail(403));
    await expect(previewPermissions("t1", { subject: { type: "member", user_id: "u1" } }))
      .rejects.toThrow("members.viewAs.noPermission");
    h.serverFetch.mockResolvedValue(fail(500));
    await expect(previewPermissions("t1", { subject: { type: "member", user_id: "u1" } }))
      .rejects.toThrow("members.viewAs.failed");
  });
});

describe("losesVaultKey", () => {
  const draft = { role_ids: ["r"], allow: 0, deny: 0 };
  test("sends_scope_vault_key_gate_for_losesVaultKey", async () => {
    h.serverFetch.mockResolvedValue(ok(response(true, false)));
    expect(await losesVaultKey("t1", "u1", draft)).toBe(true);
    expect(sentBody()).toEqual({ subject: { type: "member", user_id: "u1" }, draft, scope: "vault_key_gate" });
    h.serverFetch.mockResolvedValue(ok(response(true, true)));
    expect(await losesVaultKey("t1", "u1", draft)).toBe(false);
  });
});
