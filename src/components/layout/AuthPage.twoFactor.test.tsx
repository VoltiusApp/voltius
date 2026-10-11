import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({ login: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./LogoBadge", () => ({ default: () => null }));
vi.mock("@/services/account", () => ({
  createLocalAccountNoPassword: vi.fn(),
  createServerAccount: vi.fn(),
  login: h.login,
}));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));
vi.mock("@/components/shared/VaultBackups", () => ({
  VaultBackups: () => <div data-testid="vault-backups" />,
}));

import AuthPage from "./AuthPage";
import { TwoFactorRequiredError, type TwoFactorProof } from "@/services/twoFactorProof";
import { VaultUnreadableError } from "@/services/vaultErrors";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const submit = () => userEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);

async function reachCodeStep(complete: (proof: TwoFactorProof) => Promise<unknown>, onReady = vi.fn()) {
  h.login.mockRejectedValue(new TwoFactorRequiredError(["totp", "recovery"], complete, vi.fn()));
  render(<AuthPage isLocked onReady={onReady} />);
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value: "pw" } });
  await submit();
  const code = await screen.findByPlaceholderText("layout.twoFactor.codePlaceholder");
  expect(onReady).not.toHaveBeenCalled();
  return { code, onReady };
}

test("unlocking an account that needs a code opens the app only once the code is accepted", async () => {
  const complete = vi.fn(async (_proof: TwoFactorProof) => {});
  const { code, onReady } = await reachCodeStep(complete);

  fireEvent.change(code, { target: { value: "123456" } });
  await submit();

  await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  expect(complete).toHaveBeenCalledWith({ code: "123456" });
});

test("cancelling the code step returns to the password form", async () => {
  await reachCodeStep(async () => {});
  await userEvent.click(screen.getByRole("button", { name: "common.action.cancel" }));
  expect(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeTruthy();
});

test("an unreadable vault found after the code lands on recovery, not on a code error", async () => {
  const { code, onReady } = await reachCodeStep(async () => {
    throw new VaultUnreadableError();
  });

  fireEvent.change(code, { target: { value: "123456" } });
  await submit();

  expect(await screen.findByText("layout.auth.vaultUnreadableTitle")).toBeTruthy();
  expect(onReady).not.toHaveBeenCalled();
});
