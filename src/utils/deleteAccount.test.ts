import { describe, expect, test } from "vitest";
import { DELETE_ACCOUNT_KEYWORD, deleteConfirmationTarget, isDeleteConfirmed, subscriptionStillBills } from "./deleteAccount";

describe("delete account confirmation", () => {
  test("asks for the account email when one is known", () => {
    expect(deleteConfirmationTarget("me@example.com")).toBe("me@example.com");
  });

  test("falls back to the keyword without an email", () => {
    expect(deleteConfirmationTarget(null)).toBe(DELETE_ACCOUNT_KEYWORD);
    expect(deleteConfirmationTarget("  ")).toBe(DELETE_ACCOUNT_KEYWORD);
  });

  test("accepts the email typed in any case, with stray spaces", () => {
    expect(isDeleteConfirmed("  Me@Example.com ", "me@example.com")).toBe(true);
  });

  test("rejects anything short of the full email", () => {
    expect(isDeleteConfirmed("", "me@example.com")).toBe(false);
    expect(isDeleteConfirmed("me@example", "me@example.com")).toBe(false);
    expect(isDeleteConfirmed(DELETE_ACCOUNT_KEYWORD, "me@example.com")).toBe(false);
  });

  test("the keyword fallback is case-sensitive", () => {
    expect(isDeleteConfirmed("DELETE", null)).toBe(true);
    expect(isDeleteConfirmed("delete", null)).toBe(false);
  });
});

describe("subscriptionStillBills", () => {
  const base = { billingEnabled: true, status: "active", cancelled: false };

  test("a renewing subscription still bills", () => {
    expect(subscriptionStillBills(base)).toBe(true);
    expect(subscriptionStillBills({ ...base, status: "on_trial" })).toBe(true);
    expect(subscriptionStillBills({ ...base, status: "past_due" })).toBe(true);
  });

  test("a cancelled, ended or absent subscription does not", () => {
    expect(subscriptionStillBills({ ...base, cancelled: true })).toBe(false);
    expect(subscriptionStillBills({ ...base, status: "cancelled" })).toBe(false);
    expect(subscriptionStillBills({ ...base, status: "expired" })).toBe(false);
    expect(subscriptionStillBills({ ...base, status: null })).toBe(false);
  });

  test("self-hosted servers without billing never warn", () => {
    expect(subscriptionStillBills({ ...base, billingEnabled: false })).toBe(false);
  });
});
