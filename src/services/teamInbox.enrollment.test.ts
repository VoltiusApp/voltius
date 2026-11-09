// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
import type { MyJoinRequest } from "@/services/enrollment/enrollmentPublic";

const h = vi.hoisted(() => ({
  token: null as { serverUrl: string; id: string; secret: string } | null,
  openEnroll: vi.fn(),
  resolveEnrollment: vi.fn(),
  listMyJoinRequests: vi.fn(),
  redeemEnrollment: vi.fn(),
  refreshVerificationState: vi.fn(async () => true),
  resendVerificationEmail: vi.fn(async () => {}),
  serverUrl: null as string | null,
  accountId: null as string | null,
  allowed: true,
}));

vi.mock("@/i18n", () => ({
  default: { t: (k: string, o?: Record<string, unknown>) => (o === undefined ? k : `${k}:${JSON.stringify(o)}`) },
}));
vi.mock("@/services/enrollment/machineToken", () => ({ machineEnrollmentToken: () => h.token }));
vi.mock("@/services/enrollment/enrollmentPublic", async (orig) => ({
  ...(await orig<typeof import("@/services/enrollment/enrollmentPublic")>()),
  resolveEnrollment: h.resolveEnrollment,
  listMyJoinRequests: h.listMyJoinRequests,
  redeemEnrollment: h.redeemEnrollment,
}));
vi.mock("@/services/account", () => ({
  refreshVerificationState: h.refreshVerificationState,
  resendVerificationEmail: h.resendVerificationEmail,
  getAccountId: async () => h.accountId,
}));
vi.mock("@/services/authTokens", () => ({ getServerUrl: async () => h.serverUrl }));
vi.mock("@/services/policy/serverPolicy", async (orig) => ({
  ...(await orig<typeof import("@/services/policy/serverPolicy")>()),
  serverAllowed: () => h.allowed,
}));
vi.mock("@/stores/uiStore", () => ({ useUIStore: { getState: () => ({ openEnroll: h.openEnroll }) } }));

import { useNotificationStore } from "@/stores/notificationStore";
import { useTeamStore, type Team } from "@/stores/teamStore";
import { accountKey, useEnrollmentStore } from "@/stores/enrollmentStore";
import { notifyAccountModeChanged } from "@/utils/accountMode";
import { EnrollmentError } from "@/services/enrollment/enrollmentApi";
import { reconcileEnrollment, resetTeamInboxState, startTeamInbox } from "./teamInbox";

const SRV = "https://srv.example";
const TOKEN = { serverUrl: SRV, id: "a".repeat(32), secret: "s".repeat(43) };
const ACCOUNT = { serverUrl: SRV, accountId: "acc-1" };
const KEY = accountKey(SRV, "acc-1");
const RESOLVED = { teamId: "t1", teamName: "Acme", allowedDomains: [], requireApproval: true };

const inbox = () => useNotificationStore.getState().inbox;
const entry = (id: string) => inbox().find((e) => e.id === id);
const labels = (id: string) => entry(id)?.actions.map((a) => a.label);
const run = (id: string, label: string) =>
  useNotificationStore.getState().runInboxAction(id, entry(id)!.actions.findIndex((a) => a.label === label));

function request(over: Partial<MyJoinRequest>): MyJoinRequest {
  return { id: "r1", teamId: "t1", teamName: "Acme", status: "pending", reason: "approval", createdAt: "2026-11-09T00:00:00Z", ...over };
}

const team = (id: string, name: string) => ({ id, name }) as Team;

beforeEach(() => {
  vi.clearAllMocks();
  h.token = TOKEN;
  h.allowed = true;
  resetTeamInboxState();
  useNotificationStore.setState({ inbox: [], toasts: [], history: [] });
  useTeamStore.setState({ teams: [], teamsLoaded: true });
  useEnrollmentStore.setState({ resolved: { [TOKEN.id]: { at: Date.now(), result: RESOLVED } }, records: {}, dismissedRequests: [], myRequests: [] });
});

test("invite shows for machine token when not a member", async () => {
  reconcileEnrollment(ACCOUNT);

  const id = `enroll-invite:${TOKEN.id}`;
  expect(entry(id)?.kind).toBe("enrollInvite");
  expect(entry(id)?.message).toContain("Acme");
  expect(labels(id)).toEqual(["notifications.inbox.enroll.signIn", "common.action.dismiss"]);

  await run(id, "notifications.inbox.enroll.signIn");
  expect(h.openEnroll).toHaveBeenCalledWith(TOKEN, "machine");
  expect(entry(id)?.state).toBe("pending");

  useTeamStore.setState({ teams: [team("t1", "Acme")] });
  reconcileEnrollment();
  expect(entry(id)).toBeUndefined();
});

test("invite hidden after dismiss and after any record", async () => {
  reconcileEnrollment(ACCOUNT);
  const id = `enroll-invite:${TOKEN.id}`;
  await run(id, "common.action.dismiss");
  expect(useEnrollmentStore.getState().records[`${TOKEN.id}|${KEY}`]?.outcome).toBe("dismissed");
  expect(entry(id)).toBeUndefined();

  useEnrollmentStore.setState({ records: {} });
  reconcileEnrollment();
  expect(entry(id)).toBeDefined();
  useEnrollmentStore.getState().record(TOKEN.id, KEY, { status: "pending", reason: "approval" });
  reconcileEnrollment();
  expect(entry(id)).toBeUndefined();
});

test("invite hidden for cached notFound", async () => {
  useEnrollmentStore.setState({ resolved: { [TOKEN.id]: { at: 0, failure: "notFound" } } });
  reconcileEnrollment(ACCOUNT);
  await Promise.resolve();

  expect(inbox()).toEqual([]);
  expect(h.resolveEnrollment).not.toHaveBeenCalled();
});

test("inbox does not resolve a blocked machine token", async () => {
  h.allowed = false;
  useEnrollmentStore.setState({ resolved: {} });
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  reconcileEnrollment(ACCOUNT);
  await Promise.resolve();

  expect(h.resolveEnrollment).not.toHaveBeenCalled();
  expect(entry(`enroll-invite:${TOKEN.id}`)).toBeUndefined();
  expect(useEnrollmentStore.getState().resolved).toEqual({});
});

test("invite resolves a token it has no team for, once", async () => {
  useEnrollmentStore.setState({ resolved: {} });
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  reconcileEnrollment(ACCOUNT);
  reconcileEnrollment();
  await vi.waitFor(() => expect(useEnrollmentStore.getState().resolved[TOKEN.id]?.result).toEqual(RESOLVED));
  reconcileEnrollment();

  expect(h.resolveEnrollment).toHaveBeenCalledTimes(1);
  expect(entry(`enroll-invite:${TOKEN.id}`)).toBeDefined();
});

test("invite hidden while a request for its team exists", () => {
  useEnrollmentStore.setState({ myRequests: [request({})] });
  reconcileEnrollment(ACCOUNT);

  expect(entry(`enroll-invite:${TOKEN.id}`)).toBeUndefined();
  expect(entry("enroll-pending:t1")?.kind).toBe("enrollPending");
});

test("pending email_unverified has Resend and I've verified", async () => {
  useEnrollmentStore.setState({ myRequests: [request({ reason: "email_unverified" }), request({ id: "r2", teamId: "t2", teamName: "Beta" })] });
  h.listMyJoinRequests.mockResolvedValue([request({ reason: "email_unverified" })]);
  reconcileEnrollment(ACCOUNT);

  expect(entry("enroll-pending:t1")?.message).toBe('notifications.inbox.enroll.pending.email_unverified:{"team":"Acme"}');
  expect(labels("enroll-pending:t1")).toEqual(["notifications.emailVerification.banner.resend", "notifications.emailVerification.banner.verified"]);
  expect(entry("enroll-pending:t2")?.actions).toEqual([]);

  await run("enroll-pending:t1", "notifications.emailVerification.banner.resend");
  expect(h.resendVerificationEmail).toHaveBeenCalledWith();
  expect(entry("enroll-pending:t1")?.state).toBe("pending");

  await run("enroll-pending:t1", "notifications.emailVerification.banner.verified");
  expect(h.refreshVerificationState).toHaveBeenCalled();
  expect(h.listMyJoinRequests).toHaveBeenCalledTimes(1);
  expect(h.refreshVerificationState.mock.invocationCallOrder[0]).toBeLessThan(h.listMyJoinRequests.mock.invocationCallOrder[0]);
  expect(entry("enroll-pending:t1")?.state).toBe("pending");
});

test("declined request is never re-redeemed on reconcile", async () => {
  const denied = request({ status: "denied" });
  useEnrollmentStore.setState({ myRequests: [denied] });
  h.listMyJoinRequests.mockResolvedValue([denied]);

  reconcileEnrollment(ACCOUNT);
  reconcileEnrollment();
  await useEnrollmentStore.persist.rehydrate();
  await useEnrollmentStore.getState().loadMyRequests();
  reconcileEnrollment();

  expect(entry("enroll-declined:r1")?.message).toBe('notifications.inbox.enroll.declined:{"team":"Acme"}');
  expect(labels("enroll-declined:r1")).toEqual(["notifications.inbox.enroll.askAgain", "common.action.dismiss"]);
  expect(h.redeemEnrollment).not.toHaveBeenCalled();
});

test("ask again redeems once on click", async () => {
  const denied = request({ status: "denied" });
  useEnrollmentStore.setState({ myRequests: [denied] });
  const outcome = { status: "pending" as const, reason: "approval" as const, teamId: "t1" };
  h.redeemEnrollment.mockResolvedValue(outcome);
  h.listMyJoinRequests.mockResolvedValue([request({})]);
  reconcileEnrollment(ACCOUNT);

  await Promise.all([run("enroll-declined:r1", "notifications.inbox.enroll.askAgain"), run("enroll-declined:r1", "notifications.inbox.enroll.askAgain")]);

  expect(h.redeemEnrollment).toHaveBeenCalledTimes(1);
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
  expect(useEnrollmentStore.getState().records[`${TOKEN.id}|${KEY}`]?.outcome).toEqual(outcome);
  expect(entry("enroll-declined:r1")).toBeUndefined();
  expect(entry("enroll-pending:t1")).toBeDefined();
});

test("ask again that joins directly says so", async () => {
  useEnrollmentStore.setState({ myRequests: [request({ status: "denied" })] });
  h.redeemEnrollment.mockResolvedValue({ status: "admitted", teamId: "t1" });
  h.listMyJoinRequests.mockResolvedValue([]);
  reconcileEnrollment(ACCOUNT);

  await run("enroll-declined:r1", "notifications.inbox.enroll.askAgain");

  const toasts = useNotificationStore.getState().toasts;
  expect(toasts.map((t) => [t.message, t.severity])).toEqual([['notifications.inbox.enroll.joined:{"team":"Acme"}', "success"]]);
});

test("ask again that is refused shows why and keeps the entry", async () => {
  useEnrollmentStore.setState({ myRequests: [request({ status: "denied" })] });
  h.redeemEnrollment.mockRejectedValue(new EnrollmentError("ENROLLMENT_NOT_FOUND", 404));
  reconcileEnrollment(ACCOUNT);

  await run("enroll-declined:r1", "notifications.inbox.enroll.askAgain");

  const toasts = useNotificationStore.getState().toasts;
  expect(toasts.map((t) => [t.message, t.severity])).toEqual([["layout.enroll.error.gone", "error"]]);
  expect(entry("enroll-declined:r1")?.state).toBe("pending");
  expect(useEnrollmentStore.getState().records).toEqual({});
});

test("declined without a known token for its team offers only Dismiss, which hides it", async () => {
  useEnrollmentStore.setState({ myRequests: [request({ id: "r2", teamId: "t2", teamName: "Beta", status: "denied" })] });
  reconcileEnrollment(ACCOUNT);

  expect(labels("enroll-declined:r2")).toEqual(["common.action.dismiss"]);
  await run("enroll-declined:r2", "common.action.dismiss");
  expect(entry("enroll-declined:r2")).toBeUndefined();
  expect(useEnrollmentStore.getState().dismissedRequests).toEqual(["r2"]);
  expect(useEnrollmentStore.getState().records).toEqual({});
  reconcileEnrollment();
  expect(entry("enroll-declined:r2")).toBeUndefined();
});

test("joined one-shot when pending team appears in teams", () => {
  useEnrollmentStore.setState({ myRequests: [request({})] });
  reconcileEnrollment(ACCOUNT);
  useEnrollmentStore.setState({ myRequests: [] });
  reconcileEnrollment();
  expect(useNotificationStore.getState().toasts).toEqual([]);

  useTeamStore.setState({ teams: [team("t1", "Acme")] });
  reconcileEnrollment();
  reconcileEnrollment();

  const toasts = useNotificationStore.getState().toasts;
  expect(toasts.map((t) => t.message)).toEqual(['notifications.inbox.enroll.joined:{"team":"Acme"}']);
  expect(toasts[0].severity).toBe("success");
  expect(inbox()).toEqual([]);
});

test("a server account shows nothing until its teams load, and nothing for a team it is in", () => {
  useTeamStore.setState({ teamsLoaded: false });
  useEnrollmentStore.setState({ myRequests: [request({ status: "denied" }), request({ id: "r2", teamId: "t2", teamName: "Beta" })] });
  reconcileEnrollment(ACCOUNT);
  expect(inbox()).toEqual([]);

  useTeamStore.setState({ teams: [team("t1", "Acme"), team("t2", "Beta")], teamsLoaded: true });
  reconcileEnrollment();
  expect(inbox()).toEqual([]);
  expect(useNotificationStore.getState().toasts).toEqual([]);
});

test("a server account shows nothing until its requests load", () => {
  useEnrollmentStore.setState({ myRequests: null });
  reconcileEnrollment(ACCOUNT);
  expect(inbox()).toEqual([]);

  reconcileEnrollment({ serverUrl: null, accountId: "local-1" });
  expect(inbox().map((e) => e.id)).toEqual([`enroll-invite:${TOKEN.id}`]);
});

test("missing requests route yields no request entries, the invite still shows", async () => {
  useEnrollmentStore.setState({ myRequests: null });
  h.listMyJoinRequests.mockResolvedValue(null);
  await useEnrollmentStore.getState().loadMyRequests();
  reconcileEnrollment(ACCOUNT);

  expect(inbox().map((e) => e.id)).toEqual([`enroll-invite:${TOKEN.id}`]);
});

test("a reset forgets teams it was waiting to join", () => {
  useEnrollmentStore.setState({ myRequests: [request({})] });
  reconcileEnrollment(ACCOUNT);
  resetTeamInboxState();
  useEnrollmentStore.setState({ myRequests: [] });
  useTeamStore.setState({ teams: [team("t1", "Acme")] });
  reconcileEnrollment(ACCOUNT);

  expect(useNotificationStore.getState().toasts).toEqual([]);
});

test("the inbox picks up an account that signs in after it started", async () => {
  h.serverUrl = null;
  h.accountId = null;
  useEnrollmentStore.setState({ myRequests: null });
  const stop = startTeamInbox();
  await new Promise((r) => setTimeout(r, 10));
  expect(inbox()).toEqual([]);

  h.serverUrl = SRV;
  h.accountId = "acc-1";
  useEnrollmentStore.setState({ myRequests: [request({})] });

  await vi.waitFor(() => expect(entry("enroll-pending:t1")).toBeDefined());
  stop();
});

test("a local account linked to the token's server in place gets server entries", async () => {
  h.serverUrl = null;
  h.accountId = "local-1";
  useEnrollmentStore.setState({ myRequests: null });
  const stop = startTeamInbox();
  await vi.waitFor(() => expect(entry(`enroll-invite:${TOKEN.id}`)).toBeDefined());

  h.serverUrl = SRV;
  h.accountId = "acc-2";
  notifyAccountModeChanged();
  await vi.waitFor(() => expect(entry(`enroll-invite:${TOKEN.id}`)).toBeUndefined());
  useEnrollmentStore.setState({ myRequests: [request({ status: "denied" })] });

  await vi.waitFor(() => expect(labels("enroll-declined:r1")).toEqual(["notifications.inbox.enroll.askAgain", "common.action.dismiss"]));
  h.redeemEnrollment.mockResolvedValue({ status: "pending", reason: "approval" });
  h.listMyJoinRequests.mockResolvedValue([request({})]);
  await run("enroll-declined:r1", "notifications.inbox.enroll.askAgain");
  expect(useEnrollmentStore.getState().records[`${TOKEN.id}|${accountKey(SRV, "acc-2")}`]).toBeDefined();
  stop();
});

test("no machine token and no account yields no entries", () => {
  h.token = null;
  reconcileEnrollment(ACCOUNT);
  expect(inbox()).toEqual([]);

  h.token = TOKEN;
  useEnrollmentStore.setState({ myRequests: [request({})] });
  reconcileEnrollment(null);
  expect(inbox()).toEqual([]);
});
