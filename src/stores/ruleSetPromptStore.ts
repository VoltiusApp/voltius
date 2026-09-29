import { create } from "zustand";
import type { RuleSetChange } from "@/services/ruleSetDiff";
import type { TeamMember } from "@/services/teamService";

export type RuleSetPrompt =
  | { kind: "move"; teamId: string; changes: RuleSetChange[] | null }
  | { kind: "firstRule"; teamId: string; members: { member: TeamMember; reason: "oldApp" | "noView" }[] };

interface Pending {
  prompt: RuleSetPrompt;
  resolve: (ok: boolean) => void;
}

interface RuleSetPromptState {
  queue: Pending[];
  ask: (prompt: RuleSetPrompt) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const useRuleSetPromptStore = create<RuleSetPromptState>((set, get) => ({
  queue: [],
  ask: (prompt) => new Promise<boolean>((resolve) => set((s) => ({ queue: [...s.queue, { prompt, resolve }] }))),
  answer: (ok) => {
    const [head, ...rest] = get().queue;
    if (!head) return;
    set({ queue: rest });
    head.resolve(ok);
  },
}));
