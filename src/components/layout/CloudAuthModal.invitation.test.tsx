import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  authenticateServerAccount: vi.fn(),
  addAccount: vi.fn(async () => {}),
  lookupInvitation: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/account", () => ({
  authenticateServerAccount: h.authenticateServerAccount,
  getAccountMode: vi.fn(async () => "server"),
  linkToCloud: vi.fn(),
  setMasterPassword: vi.fn(async () => {}),
  signInToCloud: vi.fn(),
}));
vi.mock("@/services/teamInvitation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/teamInvitation")>()),
  lookupInvitation: h.lookupInvitation,
}));
vi.mock("@/services/savedAccounts", () => ({ addAccount: h.addAccount }));
vi.mock("@/services/lanSync", () => ({ startSessionSync: vi.fn() }));
vi.mock("@/services/sync", () => ({ syncOnLogin: vi.fn(async () => {}), syncOnLoginReplace: vi.fn(async () => {}) }));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: (sel: (s: unknown) => unknown) => sel({ load: vi.fn(async () => {}) }),
}));

import CloudAuthModal from "./CloudAuthModal";
import { useUIStore } from "@/stores/uiStore";
import { RegistrationClosedError } from "@/services/teamInvitation";

const TOKEN = "8bd7ac77c5a247819c6490c5a007fc18a1690524f11442a7b607a546c3d56c53";
const LINK = `https://portal.acme.test/invite/${TOKEN}`;
const SESSION = { account_id: "n", email: "new@acme.test" };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUIStore.getState().openCloudAuth("register", "add");
  h.lookupInvitation.mockImplementation(async (serverUrl: string, token: string) => ({
    token, serverUrl, teamName: "Acme Ops", email: "new@acme.test", inviter: "@tidy-cedar", role: "member",
  }));
});

const lastCreateButton = () => {
  const buttons = screen.getAllByRole("button", { name: "layout.auth.createAccount" });
  return buttons[buttons.length - 1];
};
const emailField = () => screen.getByPlaceholderText<HTMLInputElement>("layout.auth.emailPlaceholder");
const invitationField = () => screen.getByPlaceholderText<HTMLInputElement>("layout.auth.invitation.placeholder");

function fillPasswords() {
  const fields = screen.getAllByPlaceholderText(/PasswordPlaceholder/);
  fields.forEach((f) => fireEvent.change(f, { target: { value: "longenough-pw" } }));
}

async function useInvitation(text = LINK) {
  await userEvent.click(screen.getByRole("button", { name: "layout.auth.invitation.toggle" }));
  fireEvent.change(invitationField(), { target: { value: text } });
  await userEvent.click(screen.getByRole("button", { name: "layout.auth.invitation.use" }));
}

test("a pasted invitation locks the invited email and registers with its token", async () => {
  h.authenticateServerAccount.mockResolvedValue({ account: SESSION, enrollment: null });
  render(<CloudAuthModal />);

  await useInvitation();

  expect(await screen.findByText("layout.auth.invitation.joining")).toBeTruthy();
  expect(emailField().value).toBe("new@acme.test");
  expect(emailField().disabled).toBe(true);

  fillPasswords();
  await userEvent.click(screen.getByRole("button", { name: "layout.auth.invitation.createAndJoin" }));

  await waitFor(() => expect(h.addAccount).toHaveBeenCalledWith(SESSION));
  const [kind, email, , serverUrl, credential] = h.authenticateServerAccount.mock.calls[0];
  expect([kind, email, credential]).toEqual(["register", "new@acme.test", { invitation: TOKEN }]);
  expect(h.lookupInvitation).toHaveBeenCalledWith(serverUrl, TOKEN);
});

test("removing the invitation unlocks the email and drops the token", async () => {
  h.authenticateServerAccount.mockResolvedValue({ account: SESSION, enrollment: null });
  render(<CloudAuthModal />);
  await useInvitation();
  await userEvent.click(await screen.findByRole("button", { name: "layout.auth.invitation.remove" }));

  expect(emailField().disabled).toBe(false);
  fireEvent.change(emailField(), { target: { value: "me@x.io" } });
  fillPasswords();
  await userEvent.click(lastCreateButton());

  await waitFor(() => expect(h.authenticateServerAccount).toHaveBeenCalled());
  expect(h.authenticateServerAccount.mock.calls[0][4]).toEqual({});
});

test("Enter in the invitation field checks the link instead of submitting", async () => {
  render(<CloudAuthModal />);
  await userEvent.click(screen.getByRole("button", { name: "layout.auth.invitation.toggle" }));
  await userEvent.type(invitationField(), `${LINK}{Enter}`);

  await waitFor(() => expect(h.lookupInvitation).toHaveBeenCalledTimes(1));
  expect(h.authenticateServerAccount).not.toHaveBeenCalled();
});

test("text that is no invitation is refused without asking the server", async () => {
  render(<CloudAuthModal />);
  await useInvitation("https://portal.acme.test/signup");
  expect(await screen.findByText("layout.auth.invitation.invalid")).toBeTruthy();
  expect(h.lookupInvitation).not.toHaveBeenCalled();
});

test("an invitation the server does not hold says so", async () => {
  h.lookupInvitation.mockResolvedValue(null);
  render(<CloudAuthModal />);
  await useInvitation();
  expect(await screen.findByText("layout.auth.invitation.notFound")).toBeTruthy();
  expect(emailField().disabled).toBe(false);
});

test("a server with registration closed opens the invitation field with the reason", async () => {
  h.authenticateServerAccount.mockRejectedValue(new RegistrationClosedError("common.error.registrationDisabled"));
  render(<CloudAuthModal />);
  fireEvent.change(emailField(), { target: { value: "me@x.io" } });
  fillPasswords();
  await userEvent.click(lastCreateButton());

  expect(await screen.findByText("layout.auth.invitation.closedHint")).toBeTruthy();
  expect(screen.queryByText("common.error.registrationDisabled")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(invitationField()).toBeTruthy();
});
