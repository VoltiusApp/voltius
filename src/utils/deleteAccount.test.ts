import { describe, expect, test } from "vitest";
import { DELETE_ACCOUNT_KEYWORD, deleteAccountFailure, deleteConfirmationTarget, isDeleteConfirmed, subscriptionRenews } from "./deleteAccount";

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

describe("subscriptionRenews", () => {
  const base = { billingEnabled: true, status: "active", cancelled: false };

  test("a renewing subscription renews", () => {
    expect(subscriptionRenews(base)).toBe(true);
    expect(subscriptionRenews({ ...base, status: "on_trial" })).toBe(true);
    expect(subscriptionRenews({ ...base, status: "past_due" })).toBe(true);
  });

  test("a cancelled, ended or absent subscription does not", () => {
    expect(subscriptionRenews({ ...base, cancelled: true })).toBe(false);
    expect(subscriptionRenews({ ...base, status: "cancelled" })).toBe(false);
    expect(subscriptionRenews({ ...base, status: "expired" })).toBe(false);
    expect(subscriptionRenews({ ...base, status: null })).toBe(false);
  });

  test("self-hosted servers without billing never mention it", () => {
    expect(subscriptionRenews({ ...base, billingEnabled: false })).toBe(false);
  });
});

describe("deleteAccountFailure", () => {
  test("owning a team with members names the teams", () => {
    expect(deleteAccountFailure(409, {
      error: "OWNS_TEAM_WITH_MEMBERS",
      teams: [{ id: "t1", name: "Ops", other_members: 2 }, { id: "t2", name: "Dev", other_members: 1 }],
    })).toEqual({ key: "shared.deleteAccount.ownsTeamWithMembers", params: { teams: "Ops, Dev" } });
  });

  test("a failed subscription cancellation says the account was kept", () => {
    expect(deleteAccountFailure(502, { error: "SUBSCRIPTION_CANCEL_FAILED" }))
      .toEqual({ key: "shared.deleteAccount.subscriptionCancelFailed", params: {} });
  });

  test("anything else falls back to the status", () => {
    expect(deleteAccountFailure(500, null)).toEqual({ key: "shared.deleteAccount.failed", params: { status: 500 } });
    expect(deleteAccountFailure(500, { error: "ACCOUNT_DELETE_FAILED" }))
      .toEqual({ key: "shared.deleteAccount.failed", params: { status: 500 } });
  });
});
