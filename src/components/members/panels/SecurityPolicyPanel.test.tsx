// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ locked: false, setLockPolicy: vi.fn((..._a: unknown[]) => Promise.resolve()) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: h.locked, isOwner: true }) }));
vi.mock("@/services/teamActionFeedback", () => ({ runTeamAction: ({ run }: { run: () => Promise<unknown> }) => run() }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));

import { SecurityPolicyPanel } from "./SecurityPolicyPanel";
import { useTeamStore } from "@/stores/teamStore";

const setTeam = (lock_policy: { max_minutes: number; force_vault: boolean } | null) =>
  useTeamStore.setState({
    teams: [{ id: "t", name: "Acme", owner_id: "o", owner_tier: "business", created_at: "", role_ids: [], lock_policy }],
    setLockPolicy: h.setLockPolicy,
  });

beforeEach(() => { h.locked = false; h.setLockPolicy.mockClear(); });
afterEach(cleanup);

test("turning enforcement on sends a 15-minute policy", () => {
  setTeam(null);
  render(<SecurityPolicyPanel teamId="t" />);
  fireEvent.click(screen.getByRole("switch", { name: "members.security.enforce" }));
  expect(h.setLockPolicy).toHaveBeenCalledWith("t", { max_minutes: 15, force_vault: false });
});

test("requiring Lock vault keeps the timeout", () => {
  setTeam({ max_minutes: 30, force_vault: false });
  render(<SecurityPolicyPanel teamId="t" />);
  fireEvent.click(screen.getByRole("switch", { name: "members.security.forceVault" }));
  expect(h.setLockPolicy).toHaveBeenCalledWith("t", { max_minutes: 30, force_vault: true });
});

test("changing the maximum keeps the vault requirement", () => {
  setTeam({ max_minutes: 30, force_vault: true });
  render(<SecurityPolicyPanel teamId="t" />);
  fireEvent.click(screen.getByRole("button", { name: "members.security.maxLabel" }));
  fireEvent.click(screen.getByText("settings.account.sessionSecurity.timeout.5min"));
  expect(h.setLockPolicy).toHaveBeenCalledWith("t", { max_minutes: 5, force_vault: true });
  expect(screen.queryByText("settings.account.sessionSecurity.timeout.never")).toBeNull();
});

test("turning enforcement off clears the policy", () => {
  setTeam({ max_minutes: 30, force_vault: true });
  render(<SecurityPolicyPanel teamId="t" />);
  fireEvent.click(screen.getByRole("switch", { name: "members.security.enforce" }));
  expect(h.setLockPolicy).toHaveBeenCalledWith("t", null);
});

test("below Business with no policy only the upsell card shows", () => {
  h.locked = true;
  setTeam(null);
  render(<SecurityPolicyPanel teamId="t" />);
  expect(screen.getByText("members.security.lockBody")).toBeTruthy();
  expect(screen.queryByRole("switch")).toBeNull();
});

test("below Business with a policy the controls are frozen and removal is offered", () => {
  h.locked = true;
  setTeam({ max_minutes: 5, force_vault: false });
  render(<SecurityPolicyPanel teamId="t" />);
  expect(screen.getByText("members.security.lapsed")).toBeTruthy();
  expect((screen.getByRole("switch", { name: "members.security.enforce" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("members.security.remove")).toBeTruthy();
});
