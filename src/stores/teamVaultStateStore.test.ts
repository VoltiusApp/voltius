import { test, expect } from "vitest";
import { isBlockedTeamVaultStatus } from "./teamVaultStateStore.ts";

test("a team vault that cannot show its contents is blocked", () => {
  expect(isBlockedTeamVaultStatus("awaiting_key")).toBe(true);
  expect(isBlockedTeamVaultStatus("offline")).toBe(true);
  expect(isBlockedTeamVaultStatus("forbidden")).toBe(true);
  expect(isBlockedTeamVaultStatus("payment_required")).toBe(true);
  expect(isBlockedTeamVaultStatus("error")).toBe(true);
});

test("a vault that is loading or loaded is not blocked", () => {
  expect(isBlockedTeamVaultStatus("idle")).toBe(false);
  expect(isBlockedTeamVaultStatus("loading")).toBe(false);
  expect(isBlockedTeamVaultStatus("loaded")).toBe(false);
});

test("a team with no status yet is not blocked", () => {
  expect(isBlockedTeamVaultStatus(undefined)).toBe(false);
});
