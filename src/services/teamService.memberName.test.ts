import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ fetchAuth: vi.fn() }));

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/authFetch", () => ({ fetchAuthJson: h.fetchAuth }));
vi.mock("@/services/authTokens", () => ({ getServerUrl: async () => "https://srv", getJwt: async () => "jwt" }));
vi.mock("@/services/featureDisabled", () => ({ featureDisabledError: async () => null }));
vi.mock("@/services/planRequired", () => ({ refuseIfPlanRequired: () => {} }));

import { setMemberName, inviteByEmail, addMemberById } from "@/services/teamService";

beforeEach(() => h.fetchAuth.mockReset());

test("setMemberName PUTs the name, null clears", async () => {
  h.fetchAuth.mockResolvedValue({ ok: true, status: 204 });
  await setMemberName("t1", "u1", "Jan Novák");
  await setMemberName("t1", "u1", null);
  expect(h.fetchAuth.mock.calls[0][0]).toBe("https://srv/v1/teams/t1/members/u1/name");
  expect(h.fetchAuth.mock.calls[0][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ name: "Jan Novák" }) });
  expect(h.fetchAuth.mock.calls[1][1]).toMatchObject({ body: JSON.stringify({ name: null }) });
});

test("setMemberName maps 403 to the permission error", async () => {
  h.fetchAuth.mockResolvedValue({ ok: false, status: 403 });
  await expect(setMemberName("t1", "u1", "X")).rejects.toThrow("common.error.insufficientPermissionNameMembers");
});

test("invites send name only when given", async () => {
  h.fetchAuth.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "invited" }) });
  await inviteByEmail("t1", "a@b.c", "member", "Jan");
  await inviteByEmail("t1", "a@b.c", "member");
  await addMemberById("t1", "u2", "member", "Eva");
  expect(JSON.parse(h.fetchAuth.mock.calls[0][1].body)).toEqual({ email: "a@b.c", role: "member", name: "Jan" });
  expect(JSON.parse(h.fetchAuth.mock.calls[1][1].body)).toEqual({ email: "a@b.c", role: "member" });
  expect(JSON.parse(h.fetchAuth.mock.calls[2][1].body)).toEqual({ user_id: "u2", role: "member", name: "Eva" });
});
