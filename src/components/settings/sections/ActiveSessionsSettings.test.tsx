import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SignedInSession } from "@/services/authSessions";

const h = vi.hoisted(() => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  revokeAllSessions: vi.fn(),
}));

vi.mock("react-i18next", async (orig) => ({
  ...(await orig<object>()),
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}(${o.name})` : k) }),
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<object>()), useIsMobile: () => false }));
vi.mock("@/services/authSessions", () => h);

import { ActiveSessionsSettings } from "./ActiveSessionsSettings";

const HERE: SignedInSession = {
  id: "s-1", device_name: "box", platform: "linux", client: "app",
  created_at: "2026-11-01T09:00:00Z", last_seen_at: new Date().toISOString(), current: true,
};
const PHONE: SignedInSession = { ...HERE, id: "s-2", device_name: "Pixel 8", platform: "android", current: false };
const TERMINAL: SignedInSession = { ...HERE, id: "s-3", device_name: null, platform: "macos", client: "cli", current: false };

const online = (on: boolean) => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => on });

beforeEach(() => {
  vi.clearAllMocks();
  online(true);
  h.listSessions.mockResolvedValue([HERE, PHONE, TERMINAL]);
  h.revokeSession.mockResolvedValue(undefined);
  h.revokeOtherSessions.mockResolvedValue(undefined);
  h.revokeAllSessions.mockResolvedValue(undefined);
});
afterEach(cleanup);

const button = (name: string) => screen.getByRole("button", { name });
const dialog = () => screen.getByText("settings.account.sessions.signOut", { selector: ".btn-danger, .btn-warning" });

async function shown() {
  render(<ActiveSessionsSettings />);
  await screen.findByText("Pixel 8");
}

test("lists each device with its platform, this-device badge and CLI tag", async () => {
  await shown();
  expect(screen.getByText("box")).toBeTruthy();
  expect(screen.getAllByText("settings.account.sessions.thisDevice")).toHaveLength(1);
  expect(screen.getByText("settings.account.sessions.unknownDevice")).toBeTruthy();
  expect(screen.getByText("settings.account.sessions.cli")).toBeTruthy();
  expect(screen.getByText(/^Android · /)).toBeTruthy();
  expect(screen.getByText(/^macOS · /)).toBeTruthy();
  expect(document.querySelector('[data-icon="lucide:smartphone"]')).toBeTruthy();
  expect(screen.getByText("settings.account.sessions.note")).toBeTruthy();
});

test("signing out another device asks first, then reloads the list", async () => {
  await shown();
  fireEvent.click(button("settings.account.sessions.signOutNamed(Pixel 8)"));
  expect(screen.getByText("settings.account.sessions.confirm.one.title(Pixel 8)")).toBeTruthy();
  expect(h.revokeSession).not.toHaveBeenCalled();

  fireEvent.click(dialog());
  await waitFor(() => expect(h.revokeSession).toHaveBeenCalledWith(PHONE));
  await waitFor(() => expect(h.listSessions).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("settings.account.sessions.confirm.one.title(Pixel 8)")).toBeNull();
});

test("cancelling the confirmation signs nothing out", async () => {
  await shown();
  fireEvent.click(button("settings.account.sessions.signOutOthers"));
  fireEvent.click(button("common.action.cancel"));
  expect(h.revokeOtherSessions).not.toHaveBeenCalled();
});

test("signing out this device says so and stops offering actions", async () => {
  await shown();
  fireEvent.click(button("settings.account.sessions.signOutNamed(box)"));
  expect(screen.getByText("settings.account.sessions.confirm.this.title")).toBeTruthy();
  fireEvent.click(dialog());

  await waitFor(() => expect(h.revokeSession).toHaveBeenCalledWith(HERE));
  expect(await screen.findAllByText("settings.account.sessions.ended")).toBeTruthy();
  expect(h.listSessions).toHaveBeenCalledTimes(1);
  expect((button("settings.account.sessions.signOutEverywhere") as HTMLButtonElement).disabled).toBe(true);
});

test("sign out other devices keeps the list and reloads it", async () => {
  await shown();
  fireEvent.click(button("settings.account.sessions.signOutOthers"));
  expect(screen.getByText("settings.account.sessions.confirm.others.title")).toBeTruthy();
  fireEvent.click(dialog());
  await waitFor(() => expect(h.revokeOtherSessions).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(h.listSessions).toHaveBeenCalledTimes(2));
});

test("sign out everywhere ends this device", async () => {
  await shown();
  fireEvent.click(button("settings.account.sessions.signOutEverywhere"));
  expect(screen.getByText("settings.account.sessions.confirm.all.title")).toBeTruthy();
  fireEvent.click(dialog());
  await waitFor(() => expect(h.revokeAllSessions).toHaveBeenCalledTimes(1));
  expect(await screen.findAllByText("settings.account.sessions.ended")).toBeTruthy();
});

test("a failed sign-out stays open with the error", async () => {
  h.revokeOtherSessions.mockRejectedValue(new Error("boom"));
  await shown();
  fireEvent.click(button("settings.account.sessions.signOutOthers"));
  fireEvent.click(dialog());
  expect(await screen.findByText("boom")).toBeTruthy();
  expect(screen.getByText("settings.account.sessions.confirm.others.title")).toBeTruthy();
});

test("an older server greys every action with the reason", async () => {
  h.listSessions.mockResolvedValue(null);
  render(<ActiveSessionsSettings />);
  const reason = "settings.account.sessions.unsupported";
  expect(await screen.findByText(reason)).toBeTruthy();
  for (const name of ["settings.account.sessions.signOutOthers", "settings.account.sessions.signOutEverywhere"]) {
    const b = button(name) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe(reason);
  }
});

test("offline greys the actions with the reason", async () => {
  online(false);
  await shown();
  const b = button("settings.account.sessions.signOutNamed(Pixel 8)") as HTMLButtonElement;
  expect(b.disabled).toBe(true);
  expect(b.title).toBe("settings.account.sessions.offline");
  fireEvent.click(b);
  expect(screen.queryByText("settings.account.sessions.confirm.one.title(Pixel 8)")).toBeNull();
});

test("a failed list offers a retry", async () => {
  h.listSessions.mockRejectedValueOnce(new Error("down"));
  render(<ActiveSessionsSettings />);
  expect(await screen.findByText("down")).toBeTruthy();
  expect((button("settings.account.sessions.signOutOthers") as HTMLButtonElement).title).toBe("settings.account.sessions.unavailable");
  fireEvent.click(button("settings.account.sessions.retry"));
  expect(await screen.findByText("Pixel 8")).toBeTruthy();
});

