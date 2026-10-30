import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    mode: "local",
    step: (name: string) => vi.fn(async (..._args: unknown[]) => { order.push(name); }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/account", () => ({
  authenticateServerAccount: vi.fn(),
  getAccountMode: vi.fn(async () => h.mode),
  getCurrentUserEmail: vi.fn(async () => null),
  login: vi.fn(),
  linkToCloud: h.step("linkToCloud"),
  setMasterPassword: h.step("setMasterPassword"),
  signInToCloud: h.step("signInToCloud"),
}));
vi.mock("@/services/savedAccounts", () => ({ addAccount: vi.fn() }));
vi.mock("@/services/lanSync", () => ({ startSessionSync: vi.fn(), leaveLanGroup: h.step("leaveLanGroup") }));
vi.mock("@/services/sync", () => ({
  syncNow: vi.fn(async () => {}),
  syncOnLogin: vi.fn(async () => {}),
  syncOnLoginReplace: vi.fn(async () => {}),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: (sel: (s: unknown) => unknown) => sel({ load: vi.fn(async () => {}) }),
}));

import CloudAuthModal from "./CloudAuthModal";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.order.length = 0;
});

const submit = () => userEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

const hookOf = async (name: "linkToCloud" | "signInToCloud", at: number) => {
  const account = await import("@/services/account");
  const lanSync = await import("@/services/lanSync");
  expect(vi.mocked(account[name]).mock.calls[0][at]).toBe(lanSync.leaveLanGroup);
  expect(lanSync.leaveLanGroup).not.toHaveBeenCalled();
};

test("link_to_cloud_leaves_group_once_the_server_accepts", async () => {
  h.mode = "local";
  useUIStore.getState().openCloudAuth("register");
  render(<CloudAuthModal />);
  type("layout.auth.emailPlaceholder", "a@x.io");
  await submit();
  await waitFor(() => expect(h.order).toEqual(["linkToCloud"]));
  await hookOf("linkToCloud", 2);
});

test("a no-password device sets its password, then links with the leave hook", async () => {
  h.mode = "local-nopassword";
  useUIStore.getState().openCloudAuth("register");
  render(<CloudAuthModal />);
  type("layout.auth.emailPlaceholder", "a@x.io");
  await screen.findByPlaceholderText("layout.cloudAuthModal.createMasterPasswordPlaceholder");
  type("layout.cloudAuthModal.createMasterPasswordPlaceholder", "longpass");
  type("layout.cloudAuthModal.confirmMasterPasswordPlaceholder", "longpass");
  await submit();
  await waitFor(() => expect(h.order).toEqual(["setMasterPassword", "linkToCloud"]));
  await hookOf("linkToCloud", 2);
});

test("signing in to an existing account leaves the group only through the sign-in hook", async () => {
  h.mode = "local";
  useUIStore.getState().openCloudAuth("signin");
  render(<CloudAuthModal />);
  type("layout.auth.emailPlaceholder", "a@x.io");
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();
  await waitFor(() => expect(h.order).toEqual(["signInToCloud"]));
  await hookOf("signInToCloud", 3);
});
