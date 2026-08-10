import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ seats: { usedSeats: 2, totalSeats: 5 } as { usedSeats: number | null; totalSeats: number | null } }));

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

afterEach(() => { cleanup(); h.seats = { usedSeats: 2, totalSeats: 5 }; });

const bar = () => document.querySelector(".h-1\\.5 > div") as HTMLElement;

test("fills the bar to the used/total ratio", () => {
  render(<SeatsMeter />);
  expect(bar().style.width).toBe("40%");
  expect(bar().style.background).toBe("var(--t-accent)");
});

test("a full team paints the bar and the summary in the error colour", () => {
  h.seats = { usedSeats: 5, totalSeats: 5 };
  render(<SeatsMeter />);
  expect(bar().style.width).toBe("100%");
  expect(bar().style.background).toBe("var(--t-status-error)");
  expect(screen.getByText(/seatsSummary/).style.color).toBe("var(--t-status-error)");
});

test("overshooting the seat count clamps the bar at 100%", () => {
  h.seats = { usedSeats: 9, totalSeats: 5 };
  render(<SeatsMeter />);
  expect(bar().style.width).toBe("100%");
});

test("an unknown total renders an empty bar and '?' placeholders", () => {
  h.seats = { usedSeats: null, totalSeats: null };
  render(<SeatsMeter />);
  expect(bar().style.width).toBe("0%");
  expect(screen.getByText(/"used":0/)).toBeTruthy();
  expect(screen.getByText(/"available":"\?","total":"\?"/)).toBeTruthy();
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
