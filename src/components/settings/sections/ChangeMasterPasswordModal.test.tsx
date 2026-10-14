import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  canRead: true,
  read: vi.fn(async (_reason: string) => ({ outcome: "ok", password: "stored-pw" as string | null })),
  change: vi.fn(async (_current: string, _next: string, _proof: unknown) => {}),
  refresh: vi.fn(async () => ({ jwt: "J" }) as { jwt: string } | "revoked" | "failed"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/platform", async () => ({
  ...(await vi.importActual<typeof import("@/utils/platform")>("@/utils/platform")),
  usePlatform: () => "windows",
}));
vi.mock("@/services/account", () => ({ changeMasterPassword: h.change }));
vi.mock("@/services/authTokens", () => ({ refreshAccessToken: h.refresh }));
vi.mock("@/services/vaultBinding", () => ({
  canReadPasswordWithSystemAuth: async () => h.canRead,
  readPasswordWithSystemAuth: h.read,
}));
vi.mock("@/services/twoFactor", () => ({
  factorMethods: () => ["totp"],
  getFactors: async () => ({}),
  passkeyStepUp: vi.fn(),
}));

const { default: ChangeMasterPasswordModal } = await import("./ChangeMasterPasswordModal");

const KEY = "settings.account.changeMasterPassword";

beforeEach(() => {
  h.canRead = true;
  h.read.mockReset();
  h.read.mockResolvedValue({ outcome: "ok", password: "stored-pw" });
  h.change.mockReset();
  h.refresh.mockReset();
  h.refresh.mockResolvedValue({ jwt: "J" });
});
afterEach(cleanup);

async function renderModal() {
  render(<ChangeMasterPasswordModal onClose={() => {}} />);
  await act(async () => {});
}

function fillNew(value: string) {
  fireEvent.change(screen.getByPlaceholderText(`${KEY}.newPlaceholder`), { target: { value } });
  fireEvent.change(screen.getByPlaceholderText(`${KEY}.confirmPlaceholder`), { target: { value } });
}

test("a device verification stands in for the current password", async () => {
  await renderModal();
  await act(async () => fireEvent.click(screen.getByText(`${KEY}.verifyWithDevice`)));

  expect(h.read).toHaveBeenCalledWith(`${KEY}.deviceReason`);
  expect(screen.queryByPlaceholderText(`${KEY}.currentPlaceholder`)).toBeNull();
  expect(screen.getByText(`${KEY}.verifiedWithDevice`)).toBeTruthy();

  fillNew("brand-new-pw");
  await act(async () => fireEvent.click(screen.getByText(`${KEY}.changeBtn`)));
  expect(h.change).toHaveBeenCalledWith("stored-pw", "brand-new-pw", null);
});

test("a cancelled prompt keeps the typed field without an error", async () => {
  h.read.mockResolvedValue({ outcome: "cancelled", password: null });
  await renderModal();
  await act(async () => fireEvent.click(screen.getByText(`${KEY}.verifyWithDevice`)));

  expect(screen.getByPlaceholderText(`${KEY}.currentPlaceholder`)).toBeTruthy();
  expect(screen.queryByText(`${KEY}.deviceFailed`)).toBeNull();
});

test("a device that cannot confirm the user says so and keeps the typed field", async () => {
  h.read.mockResolvedValue({ outcome: "declined", password: null });
  await renderModal();
  await act(async () => fireEvent.click(screen.getByText(`${KEY}.verifyWithDevice`)));

  expect(screen.getByPlaceholderText(`${KEY}.currentPlaceholder`)).toBeTruthy();
  expect(screen.getByText(`${KEY}.deviceFailed`)).toBeTruthy();
});

test("no device verification is offered without a prompt to show", async () => {
  h.canRead = false;
  await renderModal();
  expect(screen.queryByText(`${KEY}.verifyWithDevice`)).toBeNull();
});

test("a session revoked by a password change elsewhere is caught before any prompt", async () => {
  h.refresh.mockResolvedValue("revoked");
  await renderModal();
  await act(async () => fireEvent.click(screen.getByText(`${KEY}.verifyWithDevice`)));

  expect(h.read).not.toHaveBeenCalled();
  expect(screen.getByText(`${KEY}.deviceSignedOut`)).toBeTruthy();
  expect(screen.getByPlaceholderText(`${KEY}.currentPlaceholder`)).toBeTruthy();
});

test("an unreachable server does not block the device check", async () => {
  h.refresh.mockResolvedValue("failed");
  await renderModal();
  await act(async () => fireEvent.click(screen.getByText(`${KEY}.verifyWithDevice`)));

  expect(h.read).toHaveBeenCalled();
});
