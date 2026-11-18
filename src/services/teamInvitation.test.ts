import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/fetchWithTimeout", () => ({ fetchWithTimeout: h.fetch }));

import { lookupInvitation, parseInvitationInput } from "./teamInvitation";

const TOKEN = "8bd7ac77c5a247819c6490c5a007fc18a1690524f11442a7b607a546c3d56c53";

beforeEach(() => h.fetch.mockReset());

test.each([
  [TOKEN, TOKEN],
  [`  ${TOKEN}\n`, TOKEN],
  [`https://app.voltius.app/invite/${TOKEN}`, TOKEN],
  [`https://portal.example.com/sub/invite/${TOKEN}/?utm=x#y`, TOKEN],
  [`http://127.0.0.1:3000/invite/${TOKEN}`, TOKEN],
])("reads the token from %s", (input, expected) => {
  expect(parseInvitationInput(input)).toBe(expected);
});

test.each([
  "",
  "short",
  `https://app.voltius.app/signup?invite=${TOKEN}`,
  `https://app.voltius.app/invite/${TOKEN}/extra`,
  `javascript:alert(1)//invite/${TOKEN}`,
  `https://app.voltius.app/invite/${TOKEN.slice(0, 20)}`,
])("rejects %s", (input) => {
  expect(parseInvitationInput(input)).toBeNull();
});

test("lookup reads the team, the invited address and the inviter's handle", async () => {
  h.fetch.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ team_name: "Acme Ops", email: "new@acme.test", inviter_display_name: "tidy-cedar-7113", role: "member" }),
  });
  await expect(lookupInvitation("https://srv", TOKEN)).resolves.toEqual({
    token: TOKEN, serverUrl: "https://srv", teamName: "Acme Ops", email: "new@acme.test", inviter: "@tidy-cedar-7113", role: "member",
  });
  expect(h.fetch.mock.calls[0][0]).toBe(`https://srv/v1/invitations/${TOKEN}`);
});

test("an older server without the email, and a departed inviter, leave both blank", async () => {
  h.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ team_name: "T", inviter_display_name: "A teammate", role: "editor" }) });
  await expect(lookupInvitation("https://srv", TOKEN)).resolves.toMatchObject({ email: null, inviter: "" });
});

test("an unknown token is null, any other failure throws", async () => {
  h.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
  await expect(lookupInvitation("https://srv", TOKEN)).resolves.toBeNull();
  h.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
  await expect(lookupInvitation("https://srv", TOKEN)).rejects.toThrow("common.error.invitationLookupFailed");
});
