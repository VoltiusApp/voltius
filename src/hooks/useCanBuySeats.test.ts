// @vitest-environment jsdom
import { expect, test, vi } from "vitest";

const checkout = vi.hoisted(() => ({ value: true }));
vi.mock("@/services/distribution", () => ({
  get CAN_OPEN_CHECKOUT() {
    return checkout.value;
  },
}));

import { canBuySeats } from "./useCanBuySeats";

const owner = { billingEnabled: true, ownsTeamsPlan: true, ownerId: "me", myUserId: "me" };

test("the billing owner with their own Teams plan can buy seats", () => {
  expect(canBuySeats(owner)).toBe(true);
});

test("a seat member, a co-owner or a manager cannot buy seats on their own subscription", () => {
  expect(canBuySeats({ ...owner, ownsTeamsPlan: false })).toBe(false);
  expect(canBuySeats({ ...owner, ownerId: "someone-else" })).toBe(false);
  expect(canBuySeats({ ...owner, myUserId: "", ownerId: "" })).toBe(false);
});

test("no seat purchase without billing or checkout", () => {
  expect(canBuySeats({ ...owner, billingEnabled: false })).toBe(false);
  checkout.value = false;
  try {
    expect(canBuySeats(owner)).toBe(false);
  } finally {
    checkout.value = true;
  }
});
