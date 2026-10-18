import { test, expect } from "vitest";
import { seatAvailability, seatCost, seatReadout, seatState } from "./seatMath.ts";

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

test("seat state reports unknown instead of question marks", () => {
  expect(seatState(undefined, undefined)).toEqual({ kind: "unknown" });
  expect(seatState(0, null)).toEqual({ kind: "unknown" });
});

test("seat state computes availability when known", () => {
  expect(seatState(2, 10)).toEqual({ kind: "known", used: 2, total: 10, available: 8, atLimit: false });
  expect(seatState(10, 10)).toEqual({ kind: "known", used: 10, total: 10, available: 0, atLimit: true });
});

test("seatReadout: the enforced cap wins over the purchased one", () => {
  // #219: a trial owner who bought 25 is enforced at 10; showing 25 is the bug.
  expect(seatReadout(4, 10, 25, true)).toMatchObject({ kind: "known", total: 10 });
});

test("seatReadout: with billing, no enforced cap falls back to what was purchased", () => {
  expect(seatReadout(2, null, 5, true)).toMatchObject({ kind: "known", total: 5 });
  expect(seatReadout(2, null, null, true)).toEqual({ kind: "unknown" });
});

test("seatReadout: without billing, no enforced cap is unlimited whatever seats reports", () => {
  // #649: a self-hosted server still sends the billing fallback of 3 seats.
  expect(seatReadout(1, null, 3, false)).toEqual({ kind: "unlimited", used: 1 });
  expect(seatReadout(1, null, null, false)).toEqual({ kind: "unlimited", used: 1 });
});

test("seatReadout: without billing, an operator-set cap is still shown and enforced", () => {
  expect(seatReadout(5, 5, 3, false)).toMatchObject({ kind: "known", total: 5, atLimit: true });
});

test("seatReadout: a failed load stays unknown in both modes", () => {
  expect(seatReadout(null, null, null, false)).toEqual({ kind: "unknown" });
  expect(seatReadout(null, null, 3, true)).toEqual({ kind: "unknown" });
});
