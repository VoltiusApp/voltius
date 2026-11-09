import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => {
  const order: string[] = [];
  const step = (name: string) => vi.fn(async (..._args: unknown[]): Promise<unknown> => { order.push(name); return null; });
  return {
    order,
    mode: "server",
    serverUrl: "https://voltius.acme.com",
    secret: "plain",
    createServerAccount: vi.fn(),
    login: vi.fn(),
    authenticateServerAccount: vi.fn(),
    linkToCloud: step("linkToCloud"),
    setMasterPassword: step("setMasterPassword"),
    signInToCloud: step("signInToCloud"),
    resendVerificationEmail: vi.fn(),
    addAccount: vi.fn(async () => {}),
    getSavedAccounts: vi.fn(async (): Promise<unknown[]> => []),
    loadMyRequests: vi.fn(async () => {}),
    resolveEnrollment: vi.fn(),
    redeemEnrollment: vi.fn(),
    invoke: vi.fn(),
    leaveLanGroup: vi.fn(),
  };
});

const tr = (k: string, o?: Record<string, unknown>) => {
  const vars = Object.entries(o ?? {}).filter(([n]) => n !== "defaultValue");
  return vars.length ? `${k}(${vars.map(([n, v]) => `${n}=${String(v)}`).join(",")})` : k;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tr }),
  Trans: () => null,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/account", () => ({
  createServerAccount: h.createServerAccount,
  login: h.login,
  authenticateServerAccount: h.authenticateServerAccount,
  linkToCloud: h.linkToCloud,
  setMasterPassword: h.setMasterPassword,
  signInToCloud: h.signInToCloud,
  resendVerificationEmail: h.resendVerificationEmail,
  getAccountMode: vi.fn(async () => h.mode),
  getAccountId: vi.fn(async () => "acc-1"),
  getCurrentUserEmail: vi.fn(async () => "me@acme.com"),
}));
vi.mock("@/services/authTokens", async (orig) => ({
  ...(await orig<typeof import("@/services/authTokens")>()),
  getServerUrl: vi.fn(async () => h.serverUrl),
}));
vi.mock("@/services/savedAccounts", () => ({ addAccount: h.addAccount, getSavedAccounts: h.getSavedAccounts }));
vi.mock("@/services/vaultSecret", () => ({ secretState: async () => h.secret }));
vi.mock("@/services/lanSync", () => ({ startSessionSync: vi.fn(), leaveLanGroup: h.leaveLanGroup }));
vi.mock("@/services/sync", () => ({
  syncNow: vi.fn(async () => {}),
  syncOnLogin: vi.fn(async () => {}),
  syncOnLoginReplace: vi.fn(async () => {}),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: (sel: (s: unknown) => unknown) => sel({ load: vi.fn(async () => {}) }),
}));
vi.mock("@/services/enrollment/enrollmentPublic", async (orig) => ({
  ...(await orig<typeof import("@/services/enrollment/enrollmentPublic")>()),
  resolveEnrollment: h.resolveEnrollment,
  redeemEnrollment: h.redeemEnrollment,
}));

import EnrollModal from "./EnrollModal";
import { useUIStore, type EnrollSource } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import { accountKey, useEnrollmentStore } from "@/stores/enrollmentStore";
import type { Team } from "@/stores/teamStore";
import { TwoFactorRequiredError, type TwoFactorProof } from "@/services/twoFactorProof";

const TOKEN = {
  serverUrl: "https://voltius.acme.com",
  id: "0123456789abcdef0123456789abcdef",
  secret: "s".repeat(43),
};
const CREDENTIAL = { id: "01234567-89ab-cdef-0123-456789abcdef", secret: TOKEN.secret };
const RESOLVED = { teamId: "t1", teamName: "Acme", allowedDomains: ["acme.com"], requireApproval: true };
const PASSWORD = "password1";
const PENDING = { status: "pending", reason: "approval", teamId: "t1" } as const;
const ACCOUNT = {
  account_id: "acc-2",
  email: "jdoe@acme.com",
  server_url: TOKEN.serverUrl,
  master_password: PASSWORD,
  jwt: "JWT-2",
  refresh_token: "R-2",
  wrapped_user_secrets: null,
};

beforeEach(() => {
  h.order.length = 0;
  vi.clearAllMocks();
  h.linkToCloud.mockImplementation(async () => { h.order.push("linkToCloud"); return null; });
  h.mode = "server";
  h.serverUrl = TOKEN.serverUrl;
  h.secret = "plain";
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  h.redeemEnrollment.mockResolvedValue(PENDING);
  h.invoke.mockImplementation(async (cmd: string) => (cmd === "os_user_name" ? "jdoe" : null));
  h.getSavedAccounts.mockResolvedValue([]);
  useEnrollmentStore.setState({ resolved: {}, records: {}, loadMyRequests: h.loadMyRequests });
  useTeamStore.setState({ teams: [] });
});
afterEach(() => {
  cleanup();
  useUIStore.getState().closeEnroll();
});

async function open(source: EnrollSource = "machine") {
  await act(async () => useUIStore.getState().openEnroll(TOKEN, source));
  render(<EnrollModal />);
}

const emailField = () => screen.findByPlaceholderText<HTMLInputElement>("layout.auth.emailPlaceholder");
const suggested = () => waitFor(async () => expect((await emailField()).value).toBe("jdoe@acme.com"));
const submit = () => fireEvent.submit(document.querySelector("form")!);
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
const approvalShown = () => screen.findByText("layout.enroll.outcome.approval.title(team=Acme,email=jdoe@acme.com)");
const pressEscape = () => fireEvent.keyDown(document, { key: "Escape" });
const closed = () => waitFor(() => expect(useUIStore.getState().enrollTarget).toBeNull());

function expectNothingSent() {
  expect(h.authenticateServerAccount).not.toHaveBeenCalled();
  expect(h.createServerAccount).not.toHaveBeenCalled();
  expect(h.login).not.toHaveBeenCalled();
  expect(h.linkToCloud).not.toHaveBeenCalled();
  expect(h.signInToCloud).not.toHaveBeenCalled();
  expect(h.redeemEnrollment).not.toHaveBeenCalled();
}

async function createOnOtherServer() {
  h.serverUrl = "https://cloud.voltius.app";
  h.authenticateServerAccount.mockResolvedValue({ account: ACCOUNT, enrollment: null });
  await open();
  await suggested();
  type("layout.auth.masterPasswordMinPlaceholder", PASSWORD);
  type("layout.auth.confirmPasswordPlaceholder", PASSWORD);
  submit();
  await approvalShown();
}

test("existing member sees already-in and nothing is sent", async () => {
  useTeamStore.setState({ teams: [{ id: "t1", name: "Acme" } as Team] });
  await open("link");
  expect(await screen.findByText("layout.enroll.already.title(team=Acme)")).toBeTruthy();
  expect(screen.queryByText(/layout\.enroll\.confirm\.title/)).toBeNull();
  fireEvent.click(screen.getByText("common.action.close"));
  await closed();
  expectNothingSent();
  expect(h.addAccount).not.toHaveBeenCalled();
});

test("same-server account sees Join step and redeems with active session", async () => {
  await open();
  expect(await screen.findByText("layout.enroll.join.title(team=Acme,email=me@acme.com)")).toBeTruthy();
  expect(screen.queryByPlaceholderText("layout.auth.emailPlaceholder")).toBeNull();
  expectNothingSent();
  fireEvent.click(screen.getByText("layout.enroll.join.action"));
  expect(await screen.findByText("layout.enroll.outcome.approval.title(team=Acme,email=me@acme.com)")).toBeTruthy();
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
  expect(h.authenticateServerAccount).not.toHaveBeenCalled();
  expect(useEnrollmentStore.getState().records[`${TOKEN.id}|${accountKey(TOKEN.serverUrl, "acc-1")}`]?.outcome).toEqual(PENDING);
  fireEvent.click(screen.getByText("layout.enroll.continue"));
  await closed();
  expect(h.addAccount).not.toHaveBeenCalled();
});

test("join step pending outcome reloads my requests", async () => {
  await open();
  fireEvent.click(await screen.findByText("layout.enroll.join.action"));
  expect(await screen.findByText("layout.enroll.outcome.approval.title(team=Acme,email=me@acme.com)")).toBeTruthy();
  expect(h.loadMyRequests).toHaveBeenCalledTimes(1);
});

test("Use another account is disabled while Join is loading", async () => {
  let settle!: (o: unknown) => void;
  h.redeemEnrollment.mockReturnValue(new Promise((r) => { settle = r; }));
  await open();
  fireEvent.click(await screen.findByText("layout.enroll.join.action"));
  await waitFor(() => expect(screen.getByText("layout.enroll.join.other").closest("button")!.disabled).toBe(true));
  pressEscape();
  expect(useUIStore.getState().enrollTarget).not.toBeNull();
  await act(async () => settle(PENDING));
  expect(await screen.findByText("layout.enroll.outcome.approval.title(team=Acme,email=me@acme.com)")).toBeTruthy();
});

test("a saved account on the token's server preselects sign in with its email", async () => {
  h.serverUrl = "https://cloud.voltius.app";
  h.getSavedAccounts.mockResolvedValue([{ ...ACCOUNT, email: "saved@acme.com" }]);
  await open();
  await waitFor(async () => expect((await emailField()).value).toBe("saved@acme.com"));
  expect(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeTruthy();
  expect(screen.queryByPlaceholderText("layout.auth.confirmPasswordPlaceholder")).toBeNull();
});

async function submitWithHeldSignIn() {
  h.serverUrl = "https://cloud.voltius.app";
  let settle!: (v: unknown) => void;
  h.authenticateServerAccount.mockReturnValue(new Promise((r) => { settle = r; }));
  await open();
  await suggested();
  type("layout.auth.masterPasswordMinPlaceholder", PASSWORD);
  type("layout.auth.confirmPasswordPlaceholder", PASSWORD);
  submit();
  await waitFor(() => expect(h.authenticateServerAccount).toHaveBeenCalled());
  return (v: unknown) => act(async () => settle(v));
}

test("closing during submit is ignored until it settles", async () => {
  const settle = await submitWithHeldSignIn();
  pressEscape();
  fireEvent.click(screen.getByText("common.action.cancel"));
  expect(useUIStore.getState().enrollTarget).not.toBeNull();
  await settle({ account: ACCOUNT, enrollment: null });
  await approvalShown();
  pressEscape();
  await closed();
  expect(h.addAccount).toHaveBeenCalledWith(ACCOUNT);
});

test("a late result does not appear in a reopened modal", async () => {
  const settle = await submitWithHeldSignIn();
  await act(async () => useUIStore.getState().closeEnroll());
  await act(async () => useUIStore.getState().openEnroll(TOKEN, "machine"));
  await suggested();
  await settle({ account: ACCOUNT, enrollment: PENDING });
  expect(screen.queryByText(/layout\.enroll\.outcome/)).toBeNull();
  expect((await emailField()).disabled).toBe(false);
});

test("same-server account can use another account through the form", async () => {
  h.authenticateServerAccount.mockResolvedValue({ account: ACCOUNT, enrollment: PENDING });
  await open();
  fireEvent.click(await screen.findByText("layout.enroll.join.other"));
  fireEvent.change(await emailField(), { target: { value: "jdoe@acme.com" } });
  type("layout.auth.masterPasswordPlaceholder", PASSWORD);
  submit();
  await approvalShown();
  expect(h.authenticateServerAccount).toHaveBeenCalledWith("signin", "jdoe@acme.com", PASSWORD, TOKEN.serverUrl, CREDENTIAL);
  expect(h.redeemEnrollment).not.toHaveBeenCalled();
});

test("other-server account redeems before switching and switches on Continue", async () => {
  await createOnOtherServer();
  expect(h.authenticateServerAccount).toHaveBeenCalledWith("register", "jdoe@acme.com", PASSWORD, TOKEN.serverUrl, CREDENTIAL);
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, { serverUrl: TOKEN.serverUrl, jwt: "JWT-2" });
  expect(h.addAccount).not.toHaveBeenCalled();
  expect(useEnrollmentStore.getState().records[`${TOKEN.id}|${accountKey(TOKEN.serverUrl, "acc-2")}`]?.outcome).toEqual(PENDING);
  fireEvent.click(screen.getByText("layout.enroll.continue"));
  await waitFor(() => expect(h.addAccount).toHaveBeenCalledWith(ACCOUNT));
});

test("closing after redeem still adds and switches", async () => {
  await createOnOtherServer();
  pressEscape();
  await waitFor(() => expect(h.addAccount).toHaveBeenCalledWith(ACCOUNT));
});

test("closing before submit adds nothing", async () => {
  h.serverUrl = "https://cloud.voltius.app";
  await open();
  await suggested();
  pressEscape();
  await closed();
  expect(h.addAccount).not.toHaveBeenCalled();
  expectNothingSent();
});

test("passwordless local account sets a master password then links with the credential", async () => {
  h.mode = "local-nopassword";
  h.secret = "none";
  h.linkToCloud.mockImplementation(async () => { h.order.push("linkToCloud"); return PENDING; });
  await open();
  await suggested();
  type("layout.auth.masterPasswordMinPlaceholder", PASSWORD);
  type("layout.auth.confirmPasswordPlaceholder", PASSWORD);
  submit();
  await approvalShown();
  expect(h.order).toEqual(["setMasterPassword", "linkToCloud"]);
  expect(h.setMasterPassword).toHaveBeenCalledWith(PASSWORD);
  expect(h.linkToCloud).toHaveBeenCalledWith("jdoe@acme.com", TOKEN.serverUrl, h.leaveLanGroup, PASSWORD, CREDENTIAL);
  expect(h.redeemEnrollment).not.toHaveBeenCalled();
  expect(h.addAccount).not.toHaveBeenCalled();
});

test("local account without stored password asks for the current master password", async () => {
  h.mode = "local";
  h.secret = "none";
  await open();
  await suggested();
  expect(screen.queryByPlaceholderText("layout.auth.confirmPasswordPlaceholder")).toBeNull();
  submit();
  expect(await screen.findByText("layout.cloudAuthModal.errorPasswordRequired")).toBeTruthy();
  expect(h.linkToCloud).not.toHaveBeenCalled();
  type("layout.enroll.currentPasswordPlaceholder", "old-pass");
  submit();
  await approvalShown();
  expect(h.setMasterPassword).not.toHaveBeenCalled();
  expect(h.linkToCloud).toHaveBeenCalledWith("jdoe@acme.com", TOKEN.serverUrl, h.leaveLanGroup, "old-pass", CREDENTIAL);
});

test("local account create uses linkToCloud with credential", async () => {
  h.mode = "local";
  await open();
  await suggested();
  expect(screen.getByText("layout.enroll.localNote(team=Acme)")).toBeTruthy();
  expect(screen.queryByPlaceholderText(/PasswordPlaceholder|PasswordMinPlaceholder/)).toBeNull();
  submit();
  await approvalShown();
  expect(h.linkToCloud).toHaveBeenCalledWith("jdoe@acme.com", TOKEN.serverUrl, h.leaveLanGroup, undefined, CREDENTIAL);
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
  expect(h.authenticateServerAccount).not.toHaveBeenCalled();
  expect(h.createServerAccount).not.toHaveBeenCalled();
});

test("local account sign in shows replace confirm first", async () => {
  h.mode = "local";
  await open();
  await suggested();
  fireEvent.click(screen.getByText("layout.auth.signIn"));
  type("layout.auth.masterPasswordPlaceholder", PASSWORD);
  submit();
  expect(await screen.findByText("layout.enroll.replace.title")).toBeTruthy();
  expect(h.signInToCloud).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("common.action.cancel"));
  expect(await emailField()).toBeTruthy();
  submit();
  fireEvent.click(await screen.findByText("layout.enroll.replace.confirm"));
  await approvalShown();
  expect(h.signInToCloud).toHaveBeenCalledWith("jdoe@acme.com", PASSWORD, TOKEN.serverUrl, h.leaveLanGroup);
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
  expect(h.linkToCloud).not.toHaveBeenCalled();
});

async function enterCode() {
  await screen.findByText("layout.twoFactor.verify");
  const code = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
  expect(h.redeemEnrollment).not.toHaveBeenCalled();
  fireEvent.change(code, { target: { value: "123456" } });
  fireEvent.submit(code.closest("form")!);
}

test("local sign in with a second factor syncs and redeems after the code", async () => {
  h.mode = "local";
  const complete = vi.fn(async (_proof: TwoFactorProof) => {});
  h.signInToCloud.mockRejectedValueOnce(new TwoFactorRequiredError(["totp"], complete, vi.fn()));
  await open();
  await suggested();
  fireEvent.click(screen.getByText("layout.auth.signIn"));
  type("layout.auth.masterPasswordPlaceholder", PASSWORD);
  submit();
  fireEvent.click(await screen.findByText("layout.enroll.replace.confirm"));
  await enterCode();
  await approvalShown();
  expect(complete).toHaveBeenCalledWith({ code: "123456" });
  const { syncOnLoginReplace } = await import("@/services/sync");
  expect(syncOnLoginReplace).toHaveBeenCalled();
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
});

test("other-server sign in with a second factor redeems with the new session after the code", async () => {
  h.serverUrl = "https://cloud.voltius.app";
  const complete = vi.fn(async (_proof: TwoFactorProof) => ({ account: ACCOUNT, enrollment: null }));
  h.authenticateServerAccount.mockRejectedValueOnce(new TwoFactorRequiredError(["totp"], complete, vi.fn()));
  await open();
  await suggested();
  fireEvent.click(screen.getByText("layout.auth.signIn"));
  type("layout.auth.masterPasswordPlaceholder", PASSWORD);
  submit();
  await enterCode();
  await approvalShown();
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, { serverUrl: TOKEN.serverUrl, jwt: "JWT-2" });
  fireEvent.click(screen.getByText("layout.enroll.continue"));
  await waitFor(() => expect(h.addAccount).toHaveBeenCalledWith(ACCOUNT));
});
