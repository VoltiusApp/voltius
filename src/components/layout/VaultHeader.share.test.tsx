import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/vault-share/VaultShareSheet", () => ({
  VaultShareSheet: () => <div>share-sheet</div>,
}));

import { MembersStack } from "./VaultHeader";
import type { TeamMember } from "@/services/teamService";

afterEach(cleanup);

const members = [
  { user_id: "u1", handle: "bob-builder", is_online: true, role_ids: [] },
] as unknown as TeamMember[];

test("the stack opens on click, not only on hover", () => {
  render(<MembersStack members={members} vaultId="v1" />);
  fireEvent.click(screen.getByRole("button", { name: "layout.vaultHeader.members" }));
  expect(screen.getByText("share-sheet")).toBeTruthy();
});

test("the stack is reachable by keyboard", () => {
  render(<MembersStack members={members} vaultId="v1" />);
  const trigger = screen.getByRole("button", { name: "layout.vaultHeader.members" });
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(screen.getByText("share-sheet")).toBeTruthy();
});

test("the + button opens the same sheet as the stack", () => {
  render(<MembersStack members={members} vaultId="v1" />);
  fireEvent.click(screen.getByTitle("layout.vaultHeader.inviteMember"));
  expect(screen.getByText("share-sheet")).toBeTruthy();
});
