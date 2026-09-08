import { test, expect } from "vitest";
import { seatAvailability, seatCost, displaySeatCap } from "./seatMath.ts";

test("seatAvailability: normal case", () => {
  expect(seatAvailability(2, 5)).toEqual({ used: 2, total: 5, available: 3, atLimit: false });
});

test("seatAvailability: at limit when used >= total", () => {
  expect(seatAvailability(5, 5).atLimit).toBe(true);
  expect(seatAvailability(6, 5)).toMatchObject({ atLimit: true, available: 0 }); // never negative
});

test("seatAvailability: unknown seat data is not at-limit and available is null (preserves prior UI)", () => {
  expect(seatAvailability(null, null)).toEqual({ used: 0, total: null, available: null, atLimit: false });
  expect(seatAvailability(2, null)).toEqual({ used: 2, total: null, available: null, atLimit: false });
  expect(seatAvailability(null, 5)).toMatchObject({ atLimit: false, available: 5 });
});

test("seatCost: adds seats onto current total", () => {
  expect(seatCost(5, 2, 15)).toEqual({ newTotal: 7, monthlyCost: 105 });
});

test("seatCost: null total falls back to default (3), matching BuySeatsModal", () => {
  expect(seatCost(null, 1, 15)).toEqual({ newTotal: 4, monthlyCost: 60 });
  expect(seatCost(null, 1, 15, 3)).toEqual({ newTotal: 4, monthlyCost: 60 });
});

test("displaySeatCap: the enforced cap wins over the purchased one", () => {
  // #219: a trial owner who bought 25 is enforced at 10; showing 25 is the bug.
  expect(displaySeatCap(10, 25)).toBe(10);
});

test("displaySeatCap: no enforced cap falls back to what was purchased", () => {
  // Uncapped account, or a server too old to send effective_seats — a readout of
  // "unavailable" there would blame the connection for a working account.
  expect(displaySeatCap(null, 5)).toBe(5);
  expect(displaySeatCap(null, null)).toBeNull();
});
