import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  platform: "linux",
  openUrl: vi.fn(async () => {}),
  invoke: vi.fn(),
}));

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));
vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", getPlatform: async () => h.platform }));

import {
  PasskeyCancelledError, acceptPasskeyReturn, cancelPasskeyRoundTrip, passkeyRoundTrip, type PasskeyReturn,
} from "./passkeyRoundTrip";

const CODE = "c0de-0123456789abcdef";
const PORTAL = "https://app.voltius.test/2fa/passkey#h=handle";

/** A loopback listener whose wait the test settles by hand. */
function listener() {
  let settle: { resolve: (code: string) => void; reject: (reason: Error) => void } | null = null;
  h.invoke.mockImplementation(async (command: string) => {
    if (command === "passkey_loopback_start") return 49152;
    if (command === "passkey_loopback_wait") return new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
    if (command === "passkey_loopback_stop") settle?.reject(new Error("stopped"));
    return undefined;
  });
  return { handBack: (code: string) => settle!.resolve(code), fail: () => settle!.reject(new Error("timed out")) };
}

const opened = () => vi.fn(async (_returnTo: PasskeyReturn) => ({ url: PORTAL }));
const commands = () => h.invoke.mock.calls.map(([command]) => command);

beforeEach(() => {
  vi.clearAllMocks();
  h.platform = "linux";
});

test("on a desktop the code comes back through a listener named in the return address", async () => {
  const { handBack } = listener();
  const open = opened();
  const trip = passkeyRoundTrip(open);
  await vi.waitFor(() => expect(h.openUrl).toHaveBeenCalledWith(PORTAL));

  const returnTo = open.mock.calls[0][0];
  expect(returnTo).toEqual({ kind: "loopback", port: 49152, state: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) });
  expect(h.invoke).toHaveBeenCalledWith("passkey_loopback_start", expect.objectContaining({ state: returnTo.state }));

  handBack(CODE);
  await expect(trip).resolves.toBe(CODE);
  expect(commands().pop()).toBe("passkey_loopback_stop");
});

test("cancelling ends the wait without an error to show", async () => {
  listener();
  const trip = passkeyRoundTrip(opened());
  await vi.waitFor(() => expect(h.openUrl).toHaveBeenCalled());

  cancelPasskeyRoundTrip();
  await expect(trip).rejects.toBeInstanceOf(PasskeyCancelledError);
});

test("a wait that runs out says the step was not finished", async () => {
  const { fail } = listener();
  const trip = passkeyRoundTrip(opened());
  await vi.waitFor(() => expect(h.openUrl).toHaveBeenCalled());

  fail();
  await expect(trip).rejects.toThrow("common.error.passkeyIncomplete");
});

test("a server refusal is reported as itself and the listener is closed", async () => {
  listener();
  const refused = new Error("common.error.twoFactorLocked");

  await expect(passkeyRoundTrip(async () => Promise.reject(refused))).rejects.toBe(refused);
  expect(h.openUrl).not.toHaveBeenCalled();
  expect(commands()).toContain("passkey_loopback_stop");
});

test("on a phone the code comes back in the app's own link, matched by state", async () => {
  h.platform = "android";
  const open = opened();
  const trip = passkeyRoundTrip(open);
  await vi.waitFor(() => expect(h.openUrl).toHaveBeenCalledWith(PORTAL));
  const returnTo = open.mock.calls[0][0];
  expect(returnTo.kind).toBe("app");
  expect(h.invoke).not.toHaveBeenCalled();

  expect(acceptPasskeyReturn(`voltius://passkey?c=${CODE}&s=someone-elses-state`)).toBe(true);
  expect(acceptPasskeyReturn(`voltius://passkey?c=short&s=${returnTo.state}`)).toBe(true);
  expect(acceptPasskeyReturn(`voltius://passkey?c=${CODE}&s=${returnTo.state}`)).toBe(true);
  await expect(trip).resolves.toBe(CODE);
});

test("a passkey link with no ceremony waiting is swallowed, and other links are left alone", () => {
  expect(acceptPasskeyReturn(`voltius://passkey?c=${CODE}&s=anything`)).toBe(true);
  expect(acceptPasskeyReturn("voltius://join?s=1&t=2")).toBe(false);
  expect(acceptPasskeyReturn("https://voltius.app/open/passkey?c=x")).toBe(false);
  expect(acceptPasskeyReturn("not a url")).toBe(false);
});
