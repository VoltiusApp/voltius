import { test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RuleSetPromptHost } from "./RuleSetPromptHost";
import { useRuleSetPromptStore } from "@/stores/ruleSetPromptStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: object) => (o ? `${k} ${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: (selector: (s: object) => unknown) => selector({
    rolesByTeam: { t1: [{ id: "r1", name: "sysadmin" }] },
    membersByTeam: { t1: [{ user_id: "u1", handle: "alice" }] },
  }),
}));

afterEach(() => {
  cleanup();
  useRuleSetPromptStore.setState({ queue: [] });
});

test("the move warning lists changes and resolves on confirm", async () => {
  const answer = useRuleSetPromptStore.getState().ask({
    kind: "move", teamId: "t1",
    changes: [
      { subject: { type: "role", id: "r1" }, bits: [{ permission: "CONNECT", before: "inherit", after: "deny" }] },
      { subject: { type: "member", id: "u1" }, bits: [{ permission: "VIEW", before: "deny", after: "inherit" }] },
    ],
  });
  render(<RuleSetPromptHost />);
  expect(screen.getByText(/sysadmin/)).toBeTruthy();
  expect(screen.getByText(/@alice/)).toBeTruthy();
  fireEvent.click(screen.getByText("shared.permissions.moveWarning.confirm"));
  expect(await answer).toBe(true);
});
