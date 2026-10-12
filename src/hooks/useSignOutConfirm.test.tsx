// @vitest-environment jsdom
import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  logout: vi.fn(async () => {}),
  reload: vi.fn(),
  isPro: true,
  paused: false,
  status: "success" as string,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/services/account", () => ({ logout: h.logout }));
vi.mock("@/services/sync", () => ({
  getSyncState: () => ({ status: h.status }),
  isSyncPaused: () => h.paused,
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ isPro: h.isPro }) },
}));

import { useSignOutConfirm } from "./useSignOutConfirm";

function Harness({ onError }: { onError?: (e: unknown) => void }) {
  const { requestSignOut, signOutConfirm } = useSignOutConfirm(onError);
  return (
    <>
      <button onClick={requestSignOut}>sign out</button>
      {signOutConfirm}
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isPro = true;
  h.paused = false;
  h.status = "success";
  vi.stubGlobal("location", { reload: h.reload });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a synced account signs out without being asked", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByText("sign out"));

  await waitFor(() => expect(h.reload).toHaveBeenCalled());
  expect(h.logout).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("shared.signOutConfirm.title")).toBeNull();
});

test("an account with no server copy is told what signing out erases, and can back out", async () => {
  h.isPro = false;
  render(<Harness />);
  await userEvent.click(screen.getByText("sign out"));

  expect(screen.getByText("shared.signOutConfirm.noServerCopy")).toBeTruthy();
  expect(h.logout).not.toHaveBeenCalled();

  await userEvent.click(screen.getByText("common.action.cancel"));
  expect(screen.queryByText("shared.signOutConfirm.title")).toBeNull();
  expect(h.logout).not.toHaveBeenCalled();
});

test("confirming signs out", async () => {
  h.paused = true;
  render(<Harness />);
  await userEvent.click(screen.getByText("sign out"));
  expect(screen.getByText("shared.signOutConfirm.unsynced")).toBeTruthy();

  await userEvent.click(screen.getByText("shared.signOutConfirm.confirm"));

  await waitFor(() => expect(h.reload).toHaveBeenCalled());
  expect(h.logout).toHaveBeenCalledTimes(1);
});

test("a sign-out that fails is reported and does not reload", async () => {
  const failure = new Error("keychain refused");
  h.logout.mockRejectedValueOnce(failure);
  const onError = vi.fn();
  render(<Harness onError={onError} />);
  await userEvent.click(screen.getByText("sign out"));

  await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  expect(h.reload).not.toHaveBeenCalled();
});
