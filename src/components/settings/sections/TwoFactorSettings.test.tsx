import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Held = { totp: boolean; passkeys: { id: string; name: string; created_at: string; last_used_at: string | null }[] };

const h = vi.hoisted(() => ({
  offered: { totp: true, passkeys: false },
  held: { totp: true, passkeys: [] } as Held,
  beginTwoFactorSetup: vi.fn(),
  enableTwoFactor: vi.fn(),
  addPasskey: vi.fn(),
  passkeyStepUp: vi.fn(),
  removeFactor: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  getFactors: vi.fn(),
  saveTextFile: vi.fn(async () => true),
  writeClipboard: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}(${o.name})` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/serverCapabilities", () => ({ useServerSecondFactors: () => h.offered }));
vi.mock("@/services/passkeyRoundTrip", () => {
  class PasskeyCancelledError extends Error {}
  return { PasskeyCancelledError, cancelPasskeyRoundTrip: vi.fn(), passkeyRoundTrip: vi.fn() };
});
vi.mock("@/services/twoFactor", () => ({
  beginTwoFactorSetup: h.beginTwoFactorSetup,
  enableTwoFactor: h.enableTwoFactor,
  addPasskey: h.addPasskey,
  passkeyStepUp: h.passkeyStepUp,
  removeFactor: h.removeFactor,
  regenerateRecoveryCodes: h.regenerateRecoveryCodes,
  getFactors: h.getFactors,
  factorMethods: (held: Held) => [...(held.totp ? ["totp"] : []), ...(held.passkeys.length ? ["passkey"] : []), "recovery"],
}));
vi.mock("@/services/saveFile", () => ({ saveTextFile: h.saveTextFile }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: h.writeClipboard }));

import { TwoFactorSettings } from "./TwoFactorSettings";
import { PasskeyCancelledError } from "@/services/passkeyRoundTrip";

const CODES = ["aaaa-bbbb-cccc-dddd", "eeee-ffff-gggg-hhhh"];
const LAPTOP = { id: "pk-1", name: "Laptop", created_at: "2026-10-11T08:00:00Z", last_used_at: null };
const onChange = vi.fn();

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.offered = { totp: true, passkeys: false };
  h.held = { totp: true, passkeys: [] };
  h.getFactors.mockImplementation(async () => ({ ...h.held, recoveryCodesLeft: 8 }));
});

const press = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const open = () => press(/settings\.account\.twoFactor\.label/);
const submit = () => userEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
/** The manage view's rows unlock once the account's factors are known. */
const manage = async (row: RegExp) => {
  await open();
  await waitFor(() => expect(screen.getByRole("button", { name: row })).toHaveProperty("disabled", false));
  await press(row);
};

test("nothing is shown until the account answers, or on a server that offers no factor", () => {
  const { rerender, container } = render(<TwoFactorSettings enabled={null} onChange={onChange} />);
  expect(container.innerHTML).toBe("");

  h.offered = { totp: false, passkeys: false };
  rerender(<TwoFactorSettings enabled={false} onChange={onChange} />);
  expect(container.innerHTML).toBe("");

  rerender(<TwoFactorSettings enabled onChange={onChange} />);
  expect(screen.getByText("settings.account.twoFactor.subOn")).toBeTruthy();
});

test("an authenticator goes password, QR and first code, then the recovery codes", async () => {
  h.beginTwoFactorSetup.mockResolvedValue({ secret: "SEEDSEED", otpauth_uri: "otpauth://totp/Voltius:a?secret=SEEDSEED" });
  h.enableTwoFactor.mockResolvedValue(CODES);
  render(<TwoFactorSettings enabled={false} onChange={onChange} />);
  await open();

  expect(screen.getByText("settings.account.twoFactor.introDevices")).toBeTruthy();
  expect(screen.queryByPlaceholderText("layout.twoFactor.codePlaceholder")).toBeNull();
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();

  expect(h.beginTwoFactorSetup).toHaveBeenCalledWith("pw", null);
  expect(await screen.findByRole("img", { name: "settings.account.twoFactor.qrLabel" })).toBeTruthy();
  expect(screen.getByText("SEEDSEED")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "layout.twoFactor.useRecovery" })).toBeNull();

  type("layout.twoFactor.codePlaceholder", "123456");
  await submit();

  expect(h.enableTwoFactor).toHaveBeenCalledWith("123456");
  for (const code of CODES) expect(await screen.findByText(code)).toBeTruthy();
  expect(onChange).toHaveBeenCalledWith(true);

  await press("settings.account.twoFactor.copy");
  expect(h.writeClipboard).toHaveBeenCalledWith(CODES.join("\n"));
  await press("settings.account.twoFactor.save");
  expect(h.saveTextFile).toHaveBeenCalledWith("voltius-recovery-codes.txt", `${CODES.join("\n")}\n`);
});

test("a server that offers both asks which one, and a first passkey ends on the recovery codes", async () => {
  h.offered = { totp: true, passkeys: true };
  let handBack: (codes: string[]) => void = () => {};
  h.addPasskey.mockImplementation(() => new Promise<string[]>((resolve) => (handBack = resolve)));
  render(<TwoFactorSettings enabled={false} onChange={onChange} />);
  await open();

  await press(/settings\.account\.twoFactor\.passkey /);
  type("settings.account.twoFactor.passkeyName", "Laptop");
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();

  expect(h.addPasskey).toHaveBeenCalledWith("pw", null, "Laptop");
  expect(await screen.findByText("layout.twoFactor.passkeyWaiting")).toBeTruthy();
  expect(screen.queryByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeNull();

  handBack(CODES);
  expect(await screen.findByText(CODES[0])).toBeTruthy();
  expect(onChange).toHaveBeenCalledWith(true);
});

test("the recovery codes stay up until the user says they are saved", async () => {
  h.regenerateRecoveryCodes.mockResolvedValue(CODES);
  render(<TwoFactorSettings enabled onChange={onChange} />);
  await manage(/settings\.account\.twoFactor\.newCodes/);
  type("layout.twoFactor.codePlaceholder", "123456");
  await submit();

  expect(h.regenerateRecoveryCodes).toHaveBeenCalledWith({ code: "123456" });
  await screen.findByText(CODES[0]);
  // The scrim and the header close button are the two ways out of every other view.
  fireEvent.click(document.querySelector(".fixed.inset-0")!);
  expect(screen.getByText(CODES[0])).toBeTruthy();

  await press("settings.account.twoFactor.saved");
  expect(screen.queryByText(CODES[0])).toBeNull();
});

test("turning it off takes the password and a code, and a refusal stays on the form", async () => {
  h.removeFactor.mockRejectedValueOnce(new Error("common.error.twoFactorInvalid")).mockResolvedValueOnce(false);
  render(<TwoFactorSettings enabled onChange={onChange} />);
  await manage(/settings\.account\.twoFactor\.turnOff/);

  type("layout.auth.masterPasswordPlaceholder", "pw");
  type("layout.twoFactor.codePlaceholder", "000000");
  await submit();
  expect(await screen.findByText("common.error.twoFactorInvalid")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();

  await press("layout.twoFactor.useRecovery");
  type("layout.twoFactor.recoveryPlaceholder", "aaaa-bbbb-cccc-dddd");
  await submit();

  expect(h.removeFactor).toHaveBeenLastCalledWith({ kind: "all" }, "pw", { recoveryCode: "aaaa-bbbb-cccc-dddd" });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
});

test("a passkey can confirm removing the authenticator, and the account keeps two-factor on", async () => {
  h.held = { totp: true, passkeys: [LAPTOP] };
  h.passkeyStepUp.mockResolvedValue({ passkeyCode: "CONFIRMED" });
  h.removeFactor.mockImplementation(async () => {
    h.held = { totp: false, passkeys: [LAPTOP] };
    return true;
  });
  render(<TwoFactorSettings enabled onChange={onChange} />);
  await manage(/settings\.account\.twoFactor\.authenticator /);

  expect(screen.queryByText("settings.account.twoFactor.lastFactor")).toBeNull();
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await press("layout.twoFactor.usePasskey");

  await waitFor(() => expect(h.removeFactor).toHaveBeenCalledWith({ kind: "totp" }, "pw", { passkeyCode: "CONFIRMED" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
  expect(await screen.findByText("settings.account.twoFactor.authenticatorSub")).toBeTruthy();
});

test("removing the only passkey warns that it turns two-factor off, and a cancelled prompt is not an error", async () => {
  h.offered = { totp: true, passkeys: true };
  h.held = { totp: false, passkeys: [LAPTOP] };
  h.passkeyStepUp.mockRejectedValueOnce(new PasskeyCancelledError());
  h.removeFactor.mockResolvedValue(false);
  render(<TwoFactorSettings enabled onChange={onChange} />);
  await manage(/settings\.account\.twoFactor\.passkeys /);

  expect(screen.getByText("Laptop")).toBeTruthy();
  await press("settings.account.twoFactor.passkeyRemove(Laptop)");
  expect(screen.getByText("settings.account.twoFactor.lastFactor")).toBeTruthy();
  expect(screen.getByText("settings.account.twoFactor.removePasskeyPrompt(Laptop)")).toBeTruthy();
  expect(screen.queryByPlaceholderText("layout.twoFactor.codePlaceholder")).toBeNull();

  type("layout.auth.masterPasswordPlaceholder", "pw");
  await press("layout.twoFactor.usePasskey");
  await waitFor(() => expect(h.passkeyStepUp).toHaveBeenCalled());
  expect(document.querySelector('[class*="t-status-error"]')).toBeNull();
  expect(h.removeFactor).not.toHaveBeenCalled();

  type("layout.twoFactor.recoveryPlaceholder", "aaaa-bbbb-cccc-dddd");
  await submit();
  expect(h.removeFactor).toHaveBeenCalledWith(
    { kind: "passkey", id: "pk-1", name: "Laptop" }, "pw", { recoveryCode: "aaaa-bbbb-cccc-dddd" },
  );
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
});

test("adding a second factor asks for proof of the first", async () => {
  h.offered = { totp: true, passkeys: true };
  h.addPasskey.mockImplementation(async () => {
    h.held = { totp: true, passkeys: [LAPTOP] };
    return [];
  });
  render(<TwoFactorSettings enabled onChange={onChange} />);
  await manage(/settings\.account\.twoFactor\.passkeys /);

  expect(screen.queryByText("settings.account.twoFactor.introDevices")).toBeNull();
  type("layout.auth.masterPasswordPlaceholder", "pw");
  type("layout.twoFactor.codePlaceholder", "123456");
  await submit();

  expect(h.addPasskey).toHaveBeenCalledWith("pw", { code: "123456" }, "");
  expect(await screen.findByText("Laptop")).toBeTruthy();
  expect(screen.queryByText(CODES[0])).toBeNull();
});
