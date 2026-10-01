import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Snippet } from "@/types";

vi.mock("react-i18next", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/teamService", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getMyUserId: async () => "u1",
}));

import MobileSnippetEditScreen from "./MobileSnippetEditScreen";
import { useSnippetStore } from "@/stores/snippetStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { PERM_BITS } from "@/services/permissions";

const snippet = {
  id: "s1", name: "Deploy", steps: [{ kind: "script", content: "make deploy" }], tags: [], favorite: false,
  only_for_connection_tags: [], only_for_distros: [], vault_id: "team-1", created_at: "", updated_at: "", clocks: {},
} as unknown as Snippet;

function grantOnS1(permissions: number) {
  useTeamObjectAccessStore.getState().replaceTeam("team-1", {
    s1: { type: "snippet", ruleSetId: "r1", myPermissions: permissions, parentId: null, deleted: false },
  }, true);
}

function mount() {
  useTeamStore.setState({
    teams: [{ id: "team-1" }], membersByTeam: { "team-1": [] }, rolesByTeam: { "team-1": [] },
    loadTeams: async () => {}, loadMembers: async () => {}, loadRoles: async () => {},
  } as never);
  useSnippetStore.setState({ snippets: [snippet] } as never);
  const pop = vi.fn();
  useMobileNavStore.setState({ pop } as never);
  render(<MobileSnippetEditScreen snippetId="s1" />);
  return { pop };
}

afterEach(() => {
  cleanup();
  useTeamObjectAccessStore.getState().clearAll();
});

const nameInput = () => document.querySelector("[data-mobile-snippet-name]") as HTMLInputElement;

test("locks the snippet and drops Save and Delete once edit access is revoked", () => {
  grantOnS1(PERM_BITS.VIEW | PERM_BITS.EDIT_SNIPPETS);
  mount();
  expect(nameInput().matches(":disabled")).toBe(false);
  expect(document.querySelector("[data-mobile-snippet-delete]")).not.toBeNull();

  act(() => grantOnS1(PERM_BITS.VIEW));

  expect(nameInput().matches(":disabled")).toBe(true);
  expect(document.querySelector("[data-mobile-snippet-delete]")).toBeNull();
  expect((document.querySelector("[data-mobile-snippet-save]") as HTMLButtonElement).disabled).toBe(true);
});

test("leaves the screen once the snippet disappears", () => {
  grantOnS1(PERM_BITS.VIEW | PERM_BITS.EDIT_SNIPPETS);
  const { pop } = mount();
  act(() => useSnippetStore.setState({ snippets: [] } as never));
  expect(pop).toHaveBeenCalledTimes(1);
});
