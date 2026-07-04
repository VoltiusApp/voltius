import type { Snippet, SnippetStep } from "@/types";

export type LeafStep = Extract<SnippetStep, { kind: "script" | "transfer" }>;

export interface FlattenResult {
  steps: LeafStep[];
  errors: string[];
}

const MAX_DEPTH = 50;

export function flattenSnippetSteps(root: Snippet, byId: Map<string, Snippet>): FlattenResult {
  const steps: LeafStep[] = [];
  const errors: string[] = [];

  function walk(snippet: Snippet, stack: string[], depth: number) {
    if (depth > MAX_DEPTH) {
      errors.push(`Snippet nesting too deep at "${snippet.name}"`);
      return;
    }
    for (const step of snippet.steps) {
      if (step.kind === "script" || step.kind === "transfer") {
        steps.push(step);
        continue;
      }
      if (stack.includes(step.snippet_id)) {
        errors.push(`Snippet cycle detected in "${snippet.name}"`);
        continue;
      }
      const child = byId.get(step.snippet_id);
      if (!child) {
        errors.push(`Snippet step references a missing snippet (${step.snippet_id})`);
        continue;
      }
      walk(child, [...stack, step.snippet_id], depth + 1);
    }
  }

  walk(root, [root.id], 0);
  return { steps, errors };
}
