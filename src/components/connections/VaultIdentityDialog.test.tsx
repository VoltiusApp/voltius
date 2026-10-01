import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ setVaultDefault: vi.fn(async () => {}), byTeam: {} as Record<string, string> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useCredentialPlan", () => ({
  useVaultPickChoices: () => [{ id: "own", username: "alice", name: "Alice (laptop key)" }],
}));
vi.mock("@/stores/identityPickStore", () => ({
  useIdentityPickStore: (sel: (s: unknown) => unknown) => sel({ byTeam: h.byTeam, setVaultDefault: h.setVaultDefault }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: (sel: (s: unknown) => unknown) => sel({ teams: [{ id: "t1", name: "Ops" }] }) }));

import { VaultIdentityDialog } from "./VaultIdentityDialog";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("choosing an identity and saving sets the vault default", async () => {
  const onClose = vi.fn();
  render(<VaultIdentityDialog teamId="t1" onClose={onClose} />);
  fireEvent.click(screen.getByText("Alice (laptop key)"));
  fireEvent.click(screen.getByText("common.action.save"));
  await vi.waitFor(() => expect(h.setVaultDefault).toHaveBeenCalledWith("t1", "own"));
  expect(onClose).toHaveBeenCalled();
});

test("No default clears it", async () => {
  h.byTeam = { t1: "own" };
  render(<VaultIdentityDialog teamId="t1" onClose={vi.fn()} />);
  fireEvent.click(screen.getByText("connections.vaultIdentity.none"));
  fireEvent.click(screen.getByText("common.action.save"));
  await vi.waitFor(() => expect(h.setVaultDefault).toHaveBeenCalledWith("t1", null));
});
