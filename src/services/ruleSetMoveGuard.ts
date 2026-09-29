import { getRuleSet } from "@/services/teamObjects";
import { describeRuleSetChange, type RuleSetChange } from "@/services/ruleSetDiff";
import { useRuleSetPromptStore } from "@/stores/ruleSetPromptStore";

// A bulk move saves object by object; one answer covers the whole burst.
const ANSWER_TTL_MS = 5000;
const answers = new Map<string, { at: number; answer: Promise<boolean> }>();

const entriesOf = (teamId: string, setId: string | null) => (setId ? getRuleSet(teamId, setId) : Promise.resolve([]));

async function changesBetween(teamId: string, from: string | null, to: string | null): Promise<RuleSetChange[] | null> {
  try {
    const [before, after] = await Promise.all([entriesOf(teamId, from), entriesOf(teamId, to)]);
    return describeRuleSetChange(before, after);
  } catch {
    return null;
  }
}

export function confirmRuleSetMove(teamId: string, from: string | null, to: string | null): Promise<boolean> {
  const key = `${teamId}|${from}|${to}`;
  const cached = answers.get(key);
  if (cached && Date.now() - cached.at < ANSWER_TTL_MS) return cached.answer;
  const answer = changesBetween(teamId, from, to).then((changes) =>
    changes && changes.length === 0 ? true : useRuleSetPromptStore.getState().ask({ kind: "move", teamId, changes }));
  answers.set(key, { at: Date.now(), answer });
  void answer.then(() => answers.set(key, { at: Date.now(), answer }));
  return answer;
}

export function resetMoveGuardForTests(): void {
  answers.clear();
}
