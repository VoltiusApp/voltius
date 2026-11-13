import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ createServerAccount: vi.fn(), lookupInvitation: vi.fn(), invoke: vi.fn() }));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: () => null,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./LogoBadge", () => ({ default: () => null }));
vi.mock("@/services/account", () => ({
  createLocalAccountNoPassword: vi.fn(),
  createServerAccount: h.createServerAccount,
  authenticateServerAccount: vi.fn(),
  login: vi.fn(),
  isServerMode: vi.fn(async () => false),
}));
vi.mock("@/services/teamInvitation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/teamInvitation")>()),
  lookupInvitation: h.lookupInvitation,
}));
vi.mock("@/stores/notificationStore", () => ({ APP_SOURCE: { kind: "app" },
  useNotificationStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));
vi.mock("@/components/shared/VaultBackups", () => ({ VaultBackups: () => null }));

import AuthPage from "./AuthPage";

const TOKEN = "8bd7ac77c5a247819c6490c5a007fc18a1690524f11442a7b607a546c3d56c53";

beforeEach(() => {
  h.invoke.mockReset().mockResolvedValue("unknown");
  h.createServerAccount.mockReset().mockResolvedValue(null);
  h.lookupInvitation.mockReset().mockImplementation(async (serverUrl: string, token: string) => ({
    token, serverUrl, teamName: "Acme Ops", email: "new@acme.test", inviter: "", role: "editor",
  }));
});
afterEach(cleanup);

test("first-launch sign-up registers the invited address with the invitation token", async () => {
  const onReady = vi.fn();
  render(<AuthPage isLocked={false} onReady={onReady} />);
  fireEvent.click(screen.getByText("layout.auth.cloudAccount"));
  fireEvent.click(screen.getByText("layout.auth.invitation.toggle"));
  fireEvent.change(screen.getByPlaceholderText("layout.auth.invitation.placeholder"), { target: { value: `https://p.acme.test/invite/${TOKEN}` } });
  fireEvent.click(screen.getByText("layout.auth.invitation.use"));
  expect(await screen.findByText("layout.auth.invitation.invitedAs")).toBeTruthy();

  for (const field of screen.getAllByPlaceholderText(/PasswordPlaceholder|PasswordMinPlaceholder/)) {
    fireEvent.change(field, { target: { value: "longenough-pw" } });
  }
  fireEvent.click(screen.getByText("layout.auth.invitation.createAndJoin"));

  await waitFor(() => expect(h.createServerAccount).toHaveBeenCalled());
  const [email, password, , credential] = h.createServerAccount.mock.calls[0];
  expect([email, password, credential]).toEqual(["new@acme.test", "longenough-pw", { invitation: TOKEN }]);
  await waitFor(() => expect(onReady).toHaveBeenCalled());
});
