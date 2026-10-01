import { test, expect, beforeEach, vi } from "vitest";
import { confirmRuleSetMove, resetMoveGuardForTests } from "./ruleSetMoveGuard";
import { useRuleSetPromptStore } from "@/stores/ruleSetPromptStore";
import { getRuleSet } from "@/services/teamObjects";
import { PERM_BITS } from "./permissions";

vi.mock("@/services/teamObjects", () => ({
  getRuleSet: vi.fn(),
}));

beforeEach(() => { resetMoveGuardForTests(); useRuleSetPromptStore.setState({ queue: [] }); });

test("one prompt answers a burst of identical moves", async () => {
  vi.mocked(getRuleSet).mockResolvedValue({ entries: [{ subject_type: "everyone", subject_id: null, allow: 0, deny: PERM_BITS.VIEW }], updatedAt: null });
  const all = Promise.all([confirmRuleSetMove("t1", null, "s1"), confirmRuleSetMove("t1", null, "s1")]);
  await vi.waitFor(() => expect(useRuleSetPromptStore.getState().queue).toHaveLength(1));
  useRuleSetPromptStore.getState().answer(false);
  expect(await all).toEqual([false, false]);
  expect(await confirmRuleSetMove("t1", null, "s1")).toBe(false);
});

test("no effective change needs no prompt", async () => {
  vi.mocked(getRuleSet).mockResolvedValue({ entries: [], updatedAt: null });
  expect(await confirmRuleSetMove("t1", "a", "b")).toBe(true);
  expect(useRuleSetPromptStore.getState().queue).toHaveLength(0);
});

test("an unreadable set still asks, without details", async () => {
  vi.mocked(getRuleSet).mockRejectedValue(Object.assign(new Error("x"), { status: 403 }));
  const answer = confirmRuleSetMove("t1", "a", "b");
  await vi.waitFor(() => expect(useRuleSetPromptStore.getState().queue[0]?.prompt).toMatchObject({ kind: "move", changes: null }));
  useRuleSetPromptStore.getState().answer(true);
  expect(await answer).toBe(true);
});
