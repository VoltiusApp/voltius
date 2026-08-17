import { test, expect, beforeEach, vi } from "vitest";

const USER = "9f1e2d3c-4b5a-6978-8765-43210fedcba9";
const OTHER_USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// A JWT is three dot-separated base64url segments; only the payload is read.
function jwtFor(sub: string): string {
  const payload = btoa(JSON.stringify({ sub })).replace(/\+/g, "-").replace(/\//g, "_");
  return `header.${payload}.signature`;
}

// Convention in this repo (see account.serverAuth.test.ts): i18n is mocked to
// echo the key. The variant here also echoes the interpolation values, so a
// test can assert the email actually reached the string.
vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  },
}));

const keychain: Record<string, string | null> = {};
let invokeImpl = (cmd: string, args: { key: string }) =>
  Promise.resolve(cmd === "keychain_get" ? (keychain[args.key] ?? null) : null);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { key: string }) => invokeImpl(cmd, args),
}));

const refreshSession = vi.fn();
vi.mock("@/services/account", () => ({ refreshSession: () => refreshSession() }));

const getSavedAccounts = vi.fn();
const switchToAccount = vi.fn();
vi.mock("@/services/savedAccounts", () => ({
  getSavedAccounts: () => getSavedAccounts(),
  switchToAccount: (a: unknown) => switchToAccount(a),
}));

const load = vi.fn();
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load }) },
}));

const addToast = vi.fn();
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast }) },
}));

import { handleSilentIntent } from "./deepLinkHandlers";

beforeEach(() => {
  for (const key of Object.keys(keychain)) delete keychain[key];
  invokeImpl = (cmd, args) =>
    Promise.resolve(cmd === "keychain_get" ? (keychain[args.key] ?? null) : null);
  refreshSession.mockReset().mockResolvedValue(undefined);
  load.mockReset().mockResolvedValue(undefined);
  getSavedAccounts.mockReset().mockResolvedValue([]);
  switchToAccount.mockReset();
  addToast.mockReset();
});

test("a link for the active account refreshes the session and reloads billing", async () => {
  keychain.jwt = jwtFor(USER);
  handleSilentIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshSession).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
  expect(addToast.mock.calls[0][0].severity).toBe("success");
});

test("a failed refresh reports an error and does not throw", async () => {
  keychain.jwt = jwtFor(USER);
  refreshSession.mockRejectedValue(new Error("offline"));
  handleSilentIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(addToast.mock.calls[0][0].severity).toBe("error");
});

test("a link for a saved but inactive account offers a switch instead of acting", async () => {
  keychain.jwt = jwtFor(OTHER_USER);
  const match = { account_id: "a", mode: "server", email: "other@example.com", jwt: jwtFor(USER) };
  getSavedAccounts.mockResolvedValue([match]);
  handleSilentIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshSession).not.toHaveBeenCalled();
  const entry = addToast.mock.calls[0][0];
  expect(entry.message).toContain("verifiedOther");
  expect(entry.message).toContain("other@example.com");
  expect(entry.action).toBeDefined();
  entry.action.onClick();
  expect(switchToAccount).toHaveBeenCalledWith(match);
});

test("a link matching no local account only toasts", async () => {
  handleSilentIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshSession).not.toHaveBeenCalled();
  expect(switchToAccount).not.toHaveBeenCalled();
  expect(addToast.mock.calls[0][0].action).toBeUndefined();
});

test("a malformed stored jwt is skipped rather than throwing", async () => {
  keychain.jwt = "not-a-jwt";
  getSavedAccounts.mockResolvedValue([{ account_id: "a", mode: "server", jwt: "also.not/valid" }]);
  handleSilentIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshSession).not.toHaveBeenCalled();
});

test("a rejecting keychain read falls through to the no-match toast rather than rejecting", async () => {
  invokeImpl = () => Promise.reject(new Error("keychain unavailable"));
  handleSilentIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshSession).not.toHaveBeenCalled();
  expect(addToast).toHaveBeenCalledTimes(1);
});
