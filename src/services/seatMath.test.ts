import { test, expect } from "vitest";
import { seatAvailability, seatCost } from "./seatMath.ts";

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
