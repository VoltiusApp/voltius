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

const refreshVerificationState = vi.fn();
vi.mock("@/services/account", () => ({
  refreshVerificationState: () => refreshVerificationState(),
}));

const getSavedAccounts = vi.fn();
const switchToAccount = vi.fn();
vi.mock("@/services/savedAccounts", () => ({
  getSavedAccounts: () => getSavedAccounts(),
  switchToAccount: (a: unknown) => switchToAccount(a),
}));

const addToast = vi.fn();
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast }) },
}));

import { handleUnpromptedIntent } from "./deepLinkHandlers";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  for (const key of Object.keys(keychain)) delete keychain[key];
  invokeImpl = (cmd, args) =>
    Promise.resolve(cmd === "keychain_get" ? (keychain[args.key] ?? null) : null);
  refreshVerificationState.mockReset().mockResolvedValue(true);
  getSavedAccounts.mockReset().mockResolvedValue([]);
  switchToAccount.mockReset();
  addToast.mockReset();
});

test("a link for the active account refreshes the verification state once", async () => {
  keychain.jwt = jwtFor(USER);
  handleUnpromptedIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshVerificationState).toHaveBeenCalledTimes(1);
  expect(addToast.mock.calls[0][0].severity).toBe("success");
  expect(addToast.mock.calls[0][0].message).toBe("notifications.emailVerification.toast.verified");
});

test("a refresh that leaves the account unverified reports pending, not success", async () => {
  keychain.jwt = jwtFor(USER);
  refreshVerificationState.mockResolvedValue(false);
  handleUnpromptedIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  const entry = addToast.mock.calls[0][0];
  expect(entry.message).toBe("notifications.emailVerification.toast.verifiedPending");
  expect(entry.severity).toBe("warning");
});

test("a failed refresh reports an error and does not throw", async () => {
  keychain.jwt = jwtFor(USER);
  refreshVerificationState.mockRejectedValue(new Error("offline"));
  handleUnpromptedIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(addToast.mock.calls[0][0].severity).toBe("error");
});

test("a link for a saved but inactive account offers a switch instead of acting", async () => {
  keychain.jwt = jwtFor(OTHER_USER);
  const match = { account_id: "a", mode: "server", email: "other@example.com", jwt: jwtFor(USER) };
  getSavedAccounts.mockResolvedValue([match]);
  handleUnpromptedIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshVerificationState).not.toHaveBeenCalled();
  const entry = addToast.mock.calls[0][0];
  expect(entry.message).toContain("verifiedOther");
  expect(entry.message).toContain("other@example.com");
  expect(entry.action).toBeDefined();
  expect(entry.duration).toBe(0); // the action is the only affordance: never auto-dismiss
  entry.action.onClick();
  expect(switchToAccount).toHaveBeenCalledWith(match);
});

test("a link matching no local account only toasts", async () => {
  handleUnpromptedIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshVerificationState).not.toHaveBeenCalled();
  expect(switchToAccount).not.toHaveBeenCalled();
  expect(addToast.mock.calls[0][0].action).toBeUndefined();
});

test("a malformed stored jwt is skipped rather than throwing", async () => {
  keychain.jwt = "not-a-jwt";
  getSavedAccounts.mockResolvedValue([{ account_id: "a", mode: "server", jwt: "also.not/valid" }]);
  handleUnpromptedIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshVerificationState).not.toHaveBeenCalled();
});

test("a rejecting keychain read falls through to the no-match toast rather than rejecting", async () => {
  invokeImpl = () => Promise.reject(new Error("keychain unavailable"));
  handleUnpromptedIntent({ route: "verified", userId: USER });
  await vi.waitFor(() => expect(addToast).toHaveBeenCalled());
  expect(refreshVerificationState).not.toHaveBeenCalled();
  expect(addToast).toHaveBeenCalledTimes(1);
});

test("a settings link opens the modal on the requested section", () => {
  useUIStore.setState({ settingsOpen: false, settingsSection: "appearance" });
  handleUnpromptedIntent({ route: "settings", section: "integrations" });
  const ui = useUIStore.getState();
  expect(ui.settingsOpen).toBe(true);
  expect(ui.settingsSection).toBe("integrations");
});

test("a billing link opens the account section and starts no checkout", () => {
  useUIStore.setState({ settingsOpen: false, settingsSection: "appearance" });
  handleUnpromptedIntent({ route: "billing" });
  const ui = useUIStore.getState();
  expect(ui.settingsOpen).toBe(true);
  expect(ui.settingsSection).toBe("account");
  // The route navigates; a checkout is an action and would need a prompt.
  expect(addToast).not.toHaveBeenCalled();
});

test("a notification link opens the centre and carries the entry id", () => {
  useUIStore.setState({ notificationCenterOpen: false, notificationFocusId: null });
  handleUnpromptedIntent({ route: "notification", entryId: "invite:42" });
  expect(useUIStore.getState().notificationCenterOpen).toBe(true);
  expect(useUIStore.getState().notificationFocusId).toBe("invite:42");
});

test("a notification link without an id still opens the centre", () => {
  useUIStore.setState({ notificationCenterOpen: false, notificationFocusId: "stale" });
  handleUnpromptedIntent({ route: "notification", entryId: null });
  expect(useUIStore.getState().notificationCenterOpen).toBe(true);
  expect(useUIStore.getState().notificationFocusId).toBeNull();
});
