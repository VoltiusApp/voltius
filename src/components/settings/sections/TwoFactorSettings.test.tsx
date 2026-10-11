import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  offered: true,
  beginTwoFactorSetup: vi.fn(),
  enableTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  saveTextFile: vi.fn(async () => true),
  writeClipboard: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/serverCapabilities", () => ({ useServerOffersTwoFactor: () => h.offered }));
vi.mock("@/services/twoFactor", () => ({
  beginTwoFactorSetup: h.beginTwoFactorSetup,
  enableTwoFactor: h.enableTwoFactor,
  disableTwoFactor: h.disableTwoFactor,
  regenerateRecoveryCodes: h.regenerateRecoveryCodes,
}));
vi.mock("@/services/saveFile", () => ({ saveTextFile: h.saveTextFile }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: h.writeClipboard }));

import { TwoFactorSettings } from "./TwoFactorSettings";

const CODES = ["aaaa-bbbb-cccc-dddd", "eeee-ffff-gggg-hhhh"];
const onChange = vi.fn();

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.offered = true;
});

const open = () => userEvent.click(screen.getByRole("button", { name: /settings\.account\.twoFactor\.label/ }));
const submit = () => userEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

test("nothing is shown until the account answers, or on a server that does not offer it", () => {
  const { rerender, container } = render(<TwoFactorSettings enabled={null} onChange={onChange} />);
  expect(container.innerHTML).toBe("");

  h.offered = false;
  rerender(<TwoFactorSettings enabled={false} onChange={onChange} />);
  expect(container.innerHTML).toBe("");

  rerender(<TwoFactorSettings enabled onChange={onChange} />);
  expect(screen.getByText("settings.account.twoFactor.subOn")).toBeTruthy();
});

test("turning it on goes password, QR and first code, then the recovery codes", async () => {
  h.beginTwoFactorSetup.mockResolvedValue({ secret: "SEEDSEED", otpauth_uri: "otpauth://totp/Voltius:a?secret=SEEDSEED" });
  h.enableTwoFactor.mockResolvedValue(CODES);
  render(<TwoFactorSettings enabled={false} onChange={onChange} />);
  await open();

  expect(screen.getByText("settings.account.twoFactor.introDevices")).toBeTruthy();
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();

  expect(h.beginTwoFactorSetup).toHaveBeenCalledWith("pw");
  expect(await screen.findByRole("img", { name: "settings.account.twoFactor.qrLabel" })).toBeTruthy();
  expect(screen.getByText("SEEDSEED")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "layout.twoFactor.useRecovery" })).toBeNull();

  type("layout.twoFactor.codePlaceholder", "123456");
  await submit();

  expect(h.enableTwoFactor).toHaveBeenCalledWith("123456");
  for (const code of CODES) expect(await screen.findByText(code)).toBeTruthy();
  expect(onChange).toHaveBeenCalledWith(true);

  await userEvent.click(screen.getByRole("button", { name: "settings.account.twoFactor.copy" }));
  expect(h.writeClipboard).toHaveBeenCalledWith(CODES.join("\n"));
  await userEvent.click(screen.getByRole("button", { name: "settings.account.twoFactor.save" }));
  expect(h.saveTextFile).toHaveBeenCalledWith("voltius-recovery-codes.txt", `${CODES.join("\n")}\n`);
});

test("the recovery codes stay up until the user says they are saved", async () => {
  h.regenerateRecoveryCodes.mockResolvedValue(CODES);
  render(<TwoFactorSettings enabled onChange={onChange} />);
  await open();
  await userEvent.click(screen.getByRole("button", { name: /settings\.account\.twoFactor\.newCodes/ }));
  type("layout.twoFactor.codePlaceholder", "123456");
  await submit();

  expect(h.regenerateRecoveryCodes).toHaveBeenCalledWith({ code: "123456" });
  await screen.findByText(CODES[0]);
  // The scrim and the header close button are the two ways out of every other view.
  fireEvent.click(document.querySelector(".fixed.inset-0")!);
  expect(screen.getByText(CODES[0])).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "settings.account.twoFactor.saved" }));
  expect(screen.queryByText(CODES[0])).toBeNull();
});

test("turning it off takes the password and a code, and a refusal stays on the form", async () => {
  h.disableTwoFactor.mockRejectedValueOnce(new Error("common.error.twoFactorInvalid")).mockResolvedValueOnce(undefined);
  render(<TwoFactorSettings enabled onChange={onChange} />);
  await open();
  await userEvent.click(screen.getByRole("button", { name: /settings\.account\.twoFactor\.turnOff/ }));

  type("layout.auth.masterPasswordPlaceholder", "pw");
  type("layout.twoFactor.codePlaceholder", "000000");
  await submit();
  expect(await screen.findByText("common.error.twoFactorInvalid")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "layout.twoFactor.useRecovery" }));
  type("layout.twoFactor.recoveryPlaceholder", "aaaa-bbbb-cccc-dddd");
  await submit();

  expect(h.disableTwoFactor).toHaveBeenLastCalledWith("pw", { recoveryCode: "aaaa-bbbb-cccc-dddd" });
  expect(onChange).toHaveBeenCalledWith(false);
});
