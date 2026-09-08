import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

type Seats = {
  usedSeats: number | null;
  effectiveSeats: number | null;
  totalSeats: number | null;
  isTrialActive: boolean;
};
const DEFAULT_SEATS: Seats = { usedSeats: 2, effectiveSeats: 5, totalSeats: 5, isTrialActive: false };
const h = vi.hoisted(() => ({ seats: { usedSeats: 2, effectiveSeats: 5, totalSeats: 5, isTrialActive: false } as Seats }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: Object.assign(
    (sel?: (s: typeof h.seats) => unknown) => (sel ? sel(h.seats) : h.seats),
    { getState: () => h.seats },
  ),
}));

import { SeatsMeter } from "./SeatsMeter";

afterEach(() => { cleanup(); h.seats = { ...DEFAULT_SEATS }; });

const bar = () => document.querySelector(".h-1\\.5 > div") as HTMLElement;

test("fills the bar to the used/total ratio", () => {
  render(<SeatsMeter />);
  expect(bar().style.width).toBe("40%");
  expect(bar().style.background).toBe("var(--t-accent)");
});

test("a full team paints the bar and the summary in the error colour", () => {
  h.seats = { ...DEFAULT_SEATS, usedSeats: 5 };
  render(<SeatsMeter />);
  expect(bar().style.width).toBe("100%");
  expect(bar().style.background).toBe("var(--t-status-error)");
  expect(screen.getByText(/seatsSummary/).style.color).toBe("var(--t-status-error)");
});

test("overshooting the seat count clamps the bar at 100%", () => {
  h.seats = { ...DEFAULT_SEATS, usedSeats: 9 };
  render(<SeatsMeter />);
  expect(bar().style.width).toBe("100%");
});

test("an unknown total renders an empty bar and an explicit unavailable message, never '?'", () => {
  h.seats = { ...DEFAULT_SEATS, usedSeats: null, effectiveSeats: null, totalSeats: null };
  render(<SeatsMeter />);
  expect(bar().style.width).toBe("0%");
  expect(screen.getByText("members.invite.seatsUnknown")).toBeTruthy();
  expect(screen.queryByText(/\?/)).toBeNull();
});

test("the buy-seats button appears only with a handler and reports clicks", () => {
  render(<SeatsMeter />);
  expect(screen.queryByRole("button")).toBeNull();
  cleanup();

  const onBuySeats = vi.fn();
  render(<SeatsMeter onBuySeats={onBuySeats} />);
  fireEvent.click(screen.getByRole("button"));
  expect(onBuySeats).toHaveBeenCalledOnce();
});

test("the meter measures the enforced cap, not the seats purchased", () => {
  // The #219 case: 25 bought, but an active trial caps the server at 10. A meter
  // reading 25 leaves the invite pre-check passing on invites the server 402s.
  h.seats = { usedSeats: 10, effectiveSeats: 10, totalSeats: 25, isTrialActive: true };
  render(<SeatsMeter />);
  expect(screen.getByText(/seatsSummary/).textContent).toContain('"total":10');
  expect(bar().style.background).toBe("var(--t-status-error)");
});

test("a trial-clamped cap says why it is lower than what was bought", () => {
  h.seats = { usedSeats: 4, effectiveSeats: 10, totalSeats: 25, isTrialActive: true };
  render(<SeatsMeter />);
  expect(screen.getByText(/seatsTrialClamp/).textContent).toContain('"cap":10');
  expect(screen.getByText(/seatsTrialClamp/).textContent).toContain('"purchased":25');
});

test("an unclamped cap says the count spans every team you own", () => {
  render(<SeatsMeter />);
  expect(screen.getByText("members.invite.seatsScope")).toBeTruthy();
});

test("a trial that did not clamp anything explains the scope, not the trial", () => {
  // Trialing but under the 10-seat clamp: nothing to explain away.
  h.seats = { usedSeats: 1, effectiveSeats: 3, totalSeats: 3, isTrialActive: true };
  render(<SeatsMeter />);
  expect(screen.getByText("members.invite.seatsScope")).toBeTruthy();
});

test("no enforced cap falls back to the purchased seats rather than reading as offline", () => {
  h.seats = { usedSeats: 2, effectiveSeats: null, totalSeats: 5, isTrialActive: false };
  render(<SeatsMeter />);
  expect(screen.getByText(/seatsSummary/).textContent).toContain('"total":5');
  expect(screen.queryByText("members.invite.seatsUnknown")).toBeNull();
});
