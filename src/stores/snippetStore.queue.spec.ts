import { describe, it, expect, beforeEach } from "vitest";
import { useSnippetStore } from "./snippetStore";
import type { SequencePrompt } from "@/services/snippetSequence";

function prompt(name: string): SequencePrompt {
  return {
    snippet: { name } as SequencePrompt["snippet"],
    userVars: [],
    partialTemplate: "",
    initialValues: {},
    resume: async () => ({ targets: [], flattenErrors: [] }),
  };
}

beforeEach(() => useSnippetStore.setState({ pendingSequences: [] }));

describe("pending sequence queue", () => {
  it("serves prompts first-in-first-out", () => {
    const { enqueuePendingSequence, shiftPendingSequence } = useSnippetStore.getState();
    enqueuePendingSequence(prompt("a"));
    enqueuePendingSequence(prompt("b"));

    expect(useSnippetStore.getState().pendingSequences).toHaveLength(2);
    expect(useSnippetStore.getState().pendingSequences[0].snippet.name).toBe("a");

    shiftPendingSequence();
    expect(useSnippetStore.getState().pendingSequences[0].snippet.name).toBe("b");

    shiftPendingSequence();
    expect(useSnippetStore.getState().pendingSequences).toHaveLength(0);
  });

  it("shifting an empty queue is a no-op", () => {
    useSnippetStore.getState().shiftPendingSequence();
    expect(useSnippetStore.getState().pendingSequences).toEqual([]);
  });
});
