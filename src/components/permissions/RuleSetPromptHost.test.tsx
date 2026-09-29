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
  useTeamStore: (selector: (s: { rolesByTeam: Record<string, { id: string; name: string }[]> }) => unknown) =>
    selector({ rolesByTeam: { t1: [{ id: "r1", name: "sysadmin" }] } }),
}));

afterEach(() => {
  cleanup();
  useRuleSetPromptStore.setState({ queue: [] });
});

test("the move warning lists changes and resolves on confirm", async () => {
  const answer = useRuleSetPromptStore.getState().ask({
    kind: "move", teamId: "t1",
    changes: [{ subject: { type: "role", roleId: "r1" }, bits: [{ permission: "CONNECT", before: "inherit", after: "deny" }] }],
  });
  render(<RuleSetPromptHost />);
  expect(screen.getByText(/sysadmin/)).toBeTruthy();
  fireEvent.click(screen.getByText("shared.permissions.moveWarning.confirm"));
  expect(await answer).toBe(true);
});
