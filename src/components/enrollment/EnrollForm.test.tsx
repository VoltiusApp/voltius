import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  createServerAccount: vi.fn(),
  login: vi.fn(),
  getAccountId: vi.fn(),
  resendVerificationEmail: vi.fn(),
  resolveEnrollment: vi.fn(),
  redeemEnrollment: vi.fn(),
  serverAllowed: vi.fn(),
  invoke: vi.fn(),
  passkeyRoundTrip: vi.fn(),
}));

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
vi.mock("@/services/passkeyRoundTrip", async (orig) => ({
  ...(await orig<typeof import("@/services/passkeyRoundTrip")>()),
  passkeyRoundTrip: h.passkeyRoundTrip,
}));
vi.mock("@/services/account", () => ({
  createServerAccount: h.createServerAccount,
  login: h.login,
  getAccountId: h.getAccountId,
  resendVerificationEmail: h.resendVerificationEmail,
}));
vi.mock("@/services/enrollment/enrollmentPublic", async (orig) => ({
  ...(await orig<typeof import("@/services/enrollment/enrollmentPublic")>()),
  resolveEnrollment: h.resolveEnrollment,
  redeemEnrollment: h.redeemEnrollment,
}));
vi.mock("@/services/policy/serverPolicy", async (orig) => ({
  ...(await orig<typeof import("@/services/policy/serverPolicy")>()),
  serverAllowed: h.serverAllowed,
}));

import { EnrollForm } from "./EnrollForm";
import { EnrollOutcome } from "./EnrollOutcome";
import { EnrollmentError } from "@/services/enrollment/enrollmentApi";
import { TwoFactorRequiredError, type TwoFactorProof } from "@/services/twoFactorProof";
import { accountKey, useEnrollmentStore } from "@/stores/enrollmentStore";
import type { EnrollSource } from "@/stores/uiStore";

const TOKEN = {
  serverUrl: "https://voltius.acme.com",
  id: "0123456789abcdef0123456789abcdef",
  secret: "s".repeat(43),
};
const CREDENTIAL = { id: "01234567-89ab-cdef-0123-456789abcdef", secret: TOKEN.secret };
const RESOLVED = { teamId: "t1", teamName: "Acme", allowedDomains: ["acme.com"], requireApproval: true };
const PASSWORD = "password1";

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.serverAllowed.mockReturnValue(true);
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  h.invoke.mockImplementation(async (cmd: string) => (cmd === "os_user_name" ? "jdoe" : null));
  h.getAccountId.mockResolvedValue("acc-1");
  useEnrollmentStore.setState({ resolved: {}, records: {} });
});
afterEach(cleanup);

function renderForm(source: EnrollSource = "machine") {
  const onDone = vi.fn();
  const onSkip = vi.fn();
  render(<EnrollForm token={TOKEN} source={source} host="page" activeAccount="none" onDone={onDone} onSkip={onSkip} />);
  return { onDone, onSkip };
}

const emailField = () => screen.findByPlaceholderText<HTMLInputElement>("layout.auth.emailPlaceholder");
const suggested = () => waitFor(async () => expect((await emailField()).value).toBe("jdoe@acme.com"));

async function fillCreate(email?: string) {
  if (email !== undefined) fireEvent.change(await emailField(), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordMinPlaceholder"), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByPlaceholderText("layout.auth.confirmPasswordPlaceholder"), { target: { value: PASSWORD } });
}

const submit = () => fireEvent.submit(document.querySelector("form")!);

async function signIn() {
  await suggested();
  fireEvent.click(screen.getByText("layout.auth.signIn"));
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value: PASSWORD } });
}

function expectNothingSent() {
  expect(h.createServerAccount).not.toHaveBeenCalled();
  expect(h.login).not.toHaveBeenCalled();
  expect(h.redeemEnrollment).not.toHaveBeenCalled();
}

test("link token shows server confirm step before the form and Cancel sends nothing", async () => {
  const { onSkip } = renderForm("link");
  expect(await screen.findByText("layout.enroll.confirm.title(team=Acme,host=voltius.acme.com)")).toBeTruthy();
  expect(screen.getByText("layout.enroll.confirm.body(host=voltius.acme.com)")).toBeTruthy();
  expect(screen.queryByPlaceholderText("layout.auth.emailPlaceholder")).toBeNull();
  fireEvent.click(screen.getByText("common.action.cancel"));
  expect(onSkip).toHaveBeenCalledTimes(1);
  expectNothingSent();
});

test("machine token skips confirm and shows organization label", async () => {
  renderForm("machine");
  await emailField();
  expect(screen.queryByText(/layout\.enroll\.confirm\.title/)).toBeNull();
  expect(screen.getByText("layout.enroll.orgServer")).toBeTruthy();
});

test("paste token form shows Server host without organization label", async () => {
  renderForm("paste");
  fireEvent.click(await screen.findByText("layout.enroll.continue"));
  await emailField();
  expect(screen.getByText("layout.auth.serverNamed(host=voltius.acme.com)")).toBeTruthy();
  expect(screen.queryByText("layout.enroll.orgServer")).toBeNull();
  expect(screen.queryByText("common.policy.managed")).toBeNull();
});

test("renders team name and fixed server host", async () => {
  renderForm("machine");
  expect(await screen.findByText("layout.enroll.title(team=Acme)")).toBeTruthy();
  expect(screen.getByText("layout.auth.serverNamed(host=voltius.acme.com)")).toBeTruthy();
  expect(document.querySelector('input[type="url"]')).toBeNull();
  expect(h.resolveEnrollment).toHaveBeenCalledWith(TOKEN);
  await suggested();
});

test("client domain check blocks submit", async () => {
  renderForm();
  await fillCreate("me@gmail.com");
  submit();
  expect(await screen.findByText("layout.enroll.domainError(team=Acme,domains=@acme.com)")).toBeTruthy();
  expect((await emailField()).getAttribute("aria-invalid")).toBe("true");
  expectNothingSent();
});

test("server domain mismatch returns to form", async () => {
  h.createServerAccount.mockRejectedValue(new EnrollmentError("ENROLLMENT_DOMAIN_MISMATCH", 403));
  const { onDone } = renderForm();
  await suggested();
  await fillCreate();
  submit();
  expect(await screen.findByText("layout.enroll.domainError(team=Acme,domains=@acme.com)")).toBeTruthy();
  const email = await emailField();
  expect(email.getAttribute("aria-invalid")).toBe("true");
  expect(email.disabled).toBe(false);
  expect(onDone).not.toHaveBeenCalled();
});

test("server domain mismatch after sign in is a message with Skip, not a locked field in error", async () => {
  h.login.mockResolvedValue(undefined);
  h.redeemEnrollment.mockRejectedValue(new EnrollmentError("ENROLLMENT_DOMAIN_MISMATCH", 403));
  const { onDone, onSkip } = renderForm();
  await signIn();
  submit();
  expect(await screen.findByText("layout.enroll.domainError(team=Acme,domains=@acme.com)")).toBeTruthy();
  expect((await emailField()).getAttribute("aria-invalid")).toBeNull();
  fireEvent.click(screen.getByText("layout.enroll.skip"));
  expect(onSkip).toHaveBeenCalledTimes(1);
  expect(onDone).not.toHaveBeenCalled();
});

async function reachCodeStep() {
  const complete = vi.fn(async (_proof: TwoFactorProof) => {});
  h.login.mockRejectedValue(new TwoFactorRequiredError(["totp", "passkey", "recovery"], complete, vi.fn()));
  h.redeemEnrollment.mockResolvedValue({ status: "member", teamId: "t1" });
  const rendered = renderForm();
  await signIn();
  submit();
  await screen.findByText("layout.twoFactor.verify");
  expect(h.redeemEnrollment).not.toHaveBeenCalled();
  return { complete, ...rendered };
}

test("sign in with two-factor redeems after the code", async () => {
  const { complete, onDone } = await reachCodeStep();
  const code = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
  fireEvent.change(code, { target: { value: "123456" } });
  fireEvent.submit(code.closest("form")!);
  await waitFor(() => expect(onDone).toHaveBeenCalledWith({ status: "member", teamId: "t1" }, { email: "jdoe@acme.com", teamName: "Acme" }));
  expect(complete).toHaveBeenCalledWith({ code: "123456" });
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
});

test("sign in with a passkey redeems after the ceremony", async () => {
  h.passkeyRoundTrip.mockResolvedValue("pk-code");
  const { complete, onDone } = await reachCodeStep();
  fireEvent.click(screen.getByText("layout.twoFactor.usePasskey"));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(complete).toHaveBeenCalledWith({ passkeyCode: "pk-code" });
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
});

test("create sends credential and shows pending approval outcome", async () => {
  const outcome = { status: "pending", reason: "approval", teamId: "t1" } as const;
  h.createServerAccount.mockResolvedValue(outcome);
  const { onDone } = renderForm();
  await suggested();
  await fillCreate();
  submit();
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(outcome, { email: "jdoe@acme.com", teamName: "Acme" }));
  expect(h.createServerAccount).toHaveBeenCalledWith("jdoe@acme.com", PASSWORD, TOKEN.serverUrl, CREDENTIAL);
  expect(h.redeemEnrollment).not.toHaveBeenCalled();
  expect(useEnrollmentStore.getState().records[`${TOKEN.id}|${accountKey(TOKEN.serverUrl, "acc-1")}`]?.outcome).toEqual(outcome);

  cleanup();
  render(<EnrollOutcome teamName="Acme" email="jdoe@acme.com" outcome={outcome} onContinue={vi.fn()} />);
  expect(screen.getByText("layout.enroll.outcome.approval.title(team=Acme,email=jdoe@acme.com)")).toBeTruthy();
  expect(screen.getByText("layout.enroll.outcome.approval.body(team=Acme,email=jdoe@acme.com)")).toBeTruthy();
});

test("create on old server redeems after register", async () => {
  const outcome = { status: "member", teamId: "t1" } as const;
  h.createServerAccount.mockResolvedValue(null);
  h.redeemEnrollment.mockResolvedValue(outcome);
  const { onDone } = renderForm();
  await suggested();
  await fillCreate();
  submit();
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(outcome, { email: "jdoe@acme.com", teamName: "Acme" }));
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
});

test("sign in redeems with active session", async () => {
  const outcome = { status: "admitted", teamId: "t1" } as const;
  h.login.mockResolvedValue(undefined);
  h.redeemEnrollment.mockResolvedValue(outcome);
  const { onDone } = renderForm();
  await signIn();
  submit();
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(outcome, { email: "jdoe@acme.com", teamName: "Acme" }));
  expect(h.login).toHaveBeenCalledWith(PASSWORD, "jdoe@acme.com", TOKEN.serverUrl);
  expect(h.redeemEnrollment).toHaveBeenCalledWith(TOKEN, "active");
  expect(h.createServerAccount).not.toHaveBeenCalled();
});

test("email_unverified outcome shows Resend", async () => {
  h.resendVerificationEmail.mockRejectedValue(new Error("Too many emails, try again later"));
  const onContinue = vi.fn();
  render(
    <EnrollOutcome teamName="Acme" email="jdoe@acme.com" outcome={{ status: "pending", reason: "email_unverified" }} onContinue={onContinue} />,
  );
  expect(screen.getByText("layout.enroll.outcome.email.title(team=Acme,email=jdoe@acme.com)")).toBeTruthy();
  expect(screen.getByText("layout.enroll.outcome.email.body(team=Acme,email=jdoe@acme.com)")).toBeTruthy();
  fireEvent.click(screen.getByText("layout.enroll.outcome.email.resend"));
  expect(await screen.findByText("Too many emails, try again later")).toBeTruthy();
  expect(h.resendVerificationEmail).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("layout.enroll.continue"));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test("revoked token shows A3 with Skip", async () => {
  h.resolveEnrollment.mockRejectedValue(new EnrollmentError(null, 410));
  const { onSkip } = renderForm();
  expect(await screen.findByText("layout.enroll.error.title")).toBeTruthy();
  expect(screen.getByText("layout.enroll.error.gone")).toBeTruthy();
  expect(screen.getByText("layout.auth.serverNamed(host=voltius.acme.com)")).toBeTruthy();
  fireEvent.click(screen.getByText("layout.enroll.skip"));
  expect(onSkip).toHaveBeenCalledTimes(1);
  expectNothingSent();
});

test("unreachable server offers Retry, which resolves again", async () => {
  h.resolveEnrollment.mockRejectedValueOnce(new TypeError("fetch failed"));
  renderForm();
  expect(await screen.findByText("layout.enroll.error.unreachable(host=voltius.acme.com)")).toBeTruthy();
  fireEvent.click(screen.getByText("common.action.retry"));
  await emailField();
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(2);
});

test("machine server lock elsewhere shows managed refusal and sends nothing", async () => {
  h.serverAllowed.mockReturnValue(false);
  renderForm("machine");
  expect(await screen.findByText("common.policy.serverBlocked")).toBeTruthy();
  expect(h.serverAllowed).toHaveBeenCalledWith(TOKEN.serverUrl);
  expect(h.resolveEnrollment).not.toHaveBeenCalled();
  expectNothingSent();
});
