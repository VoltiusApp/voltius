import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  load: vi.fn(async () => undefined),
  addMemberById: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: Object.assign(
    () => ({ usedSeats: 2, totalSeats: 3 }),
    { getState: () => ({ load: h.load }) },
  ),
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: (selector: (s: { addMemberById: typeof h.addMemberById }) => unknown) =>
    selector({ addMemberById: h.addMemberById }),
}));

import BuySeatsModal from "./BuySeatsModal";

const props = {
  teamId: "t1",
  pendingUser: null as { user_id: string; display_name: string } | null,
  pendingRole: "member",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function connected() {
  h.invoke.mockImplementation(async (_c: string, a: { key: string }) =>
    ({ server_url: "https://s", jwt: "jwt" }[a.key] ?? null));
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset?.());
  h.load.mockResolvedValue(undefined);
  h.addMemberById.mockResolvedValue(undefined);
  props.onClose = vi.fn();
  props.onSuccess = vi.fn();
});
afterEach(() => cleanup());

test("stepper floors additionalSeats at 1", () => {
  render(<BuySeatsModal {...props} />);
  const dec = screen.getByText("−");
  fireEvent.click(dec);
  fireEvent.click(dec); // still 1
  expect(screen.getByText("1")).toBeTruthy();
});

test("success without pendingUser: POST /billing/seats, load, onSuccess, NO addMember", async () => {
  connected();
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  render(<BuySeatsModal {...props} />);
  fireEvent.click(screen.getByText("settings.account.buySeats.buyAndInvite"));
  await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://s/v1/billing/seats");
  expect(JSON.parse(init.body)).toEqual({ seats: 4, invoice_immediately: true }); // totalSeats 3 + 1
  expect(h.load).toHaveBeenCalled();
  expect(h.addMemberById).not.toHaveBeenCalled();
});

test("success WITH pendingUser: also calls addMemberById(teamId, user, role)", async () => {
  connected();
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  render(<BuySeatsModal {...props} pendingUser={{ user_id: "u9", display_name: "Nine" }} pendingRole="editor" />);
  fireEvent.click(screen.getByText("settings.account.buySeats.buyAndInvite"));
  await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u9", "editor");
});

test("not connected (no jwt) → shows errorNotConnected, no fetch, no onSuccess", async () => {
  h.invoke.mockImplementation(async (_c: string, a: { key: string }) => (a.key === "server_url" ? "https://s" : null));
  render(<BuySeatsModal {...props} />);
  fireEvent.click(screen.getByText("settings.account.buySeats.buyAndInvite"));
  expect(await screen.findByText("settings.account.buySeats.errorNotConnected")).toBeTruthy();
  expect(h.appFetch).not.toHaveBeenCalled();
  expect(props.onSuccess).not.toHaveBeenCalled();
});

test("404 → errorNoSubscription", async () => {
  connected();
  h.appFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
  render(<BuySeatsModal {...props} />);
  fireEvent.click(screen.getByText("settings.account.buySeats.buyAndInvite"));
  expect(await screen.findByText("settings.account.buySeats.errorNoSubscription")).toBeTruthy();
  expect(props.onSuccess).not.toHaveBeenCalled();
});

test("other non-ok → errorUpdateSeats", async () => {
  connected();
  h.appFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  render(<BuySeatsModal {...props} />);
  fireEvent.click(screen.getByText("settings.account.buySeats.buyAndInvite"));
  expect(await screen.findByText("settings.account.buySeats.errorUpdateSeats")).toBeTruthy();
});
