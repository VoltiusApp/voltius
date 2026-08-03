import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/snippetSequence", () => ({ reportSequenceResult: vi.fn() }));

import { PendingSequenceModal } from "./PendingSequenceModal";
import { useSnippetStore } from "@/stores/snippetStore";
import type { SequencePrompt } from "@/services/snippetSequence";
import type { ParsedVariable } from "@/services/snippetParser";

const tokenVar: ParsedVariable = { name: "token", type: "password", dynamic: false } as ParsedVariable;

function prompt(host: string, remembered: string): SequencePrompt {
  return {
    snippet: { id: "s1", name: "deploy" } as SequencePrompt["snippet"],
    userVars: [tokenVar],
    partialTemplate: "echo {{token}}",
    initialValues: { token: remembered },
    contextLabel: host,
    resume: async () => ({ targets: [], flattenErrors: [] }),
  };
}

const tokenInput = () => screen.getByPlaceholderText("••••••••") as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByText("terminal.snippetVariableModal.execute"));

beforeEach(() => useSnippetStore.setState({ pendingSequences: [] }));
afterEach(cleanup);

describe("PendingSequenceModal", () => {
  it("re-seeds each queued prompt from its own initialValues", () => {
    const { enqueuePendingSequence } = useSnippetStore.getState();
    enqueuePendingSequence(prompt("host-1", "secret-1"));
    enqueuePendingSequence(prompt("host-2", "secret-2"));

    render(<PendingSequenceModal />);
    expect(screen.getByText("host-1")).toBeTruthy();
    expect(tokenInput().value).toBe("secret-1");

    submit();

    expect(screen.getByText("host-2")).toBeTruthy();
    expect(tokenInput().value).toBe("secret-2");
  });

  it("does not carry a typed value into the next prompt", () => {
    const { enqueuePendingSequence } = useSnippetStore.getState();
    enqueuePendingSequence(prompt("host-1", ""));
    enqueuePendingSequence(prompt("host-2", ""));

    render(<PendingSequenceModal />);
    fireEvent.change(tokenInput(), { target: { value: "typed-password" } });
    expect(tokenInput().value).toBe("typed-password");

    submit();

    expect(screen.getByText("host-2")).toBeTruthy();
    expect(tokenInput().value).toBe("");
  });

  it("submits each prompt's own resume with its own values", async () => {
    const p1 = prompt("host-1", "secret-1");
    const p2 = prompt("host-2", "secret-2");
    const r1 = vi.fn(async () => ({ targets: [], flattenErrors: [] }));
    const r2 = vi.fn(async () => ({ targets: [], flattenErrors: [] }));
    const { enqueuePendingSequence } = useSnippetStore.getState();
    enqueuePendingSequence({ ...p1, resume: r1 });
    enqueuePendingSequence({ ...p2, resume: r2 });

    render(<PendingSequenceModal />);
    submit();
    submit();

    expect(r1).toHaveBeenCalledWith({ token: "secret-1" });
    expect(r2).toHaveBeenCalledWith({ token: "secret-2" });
  });

  it("focuses the first input of a later prompt too", () => {
    const { enqueuePendingSequence } = useSnippetStore.getState();
    enqueuePendingSequence(prompt("host-1", "secret-1"));
    enqueuePendingSequence(prompt("host-2", "secret-2"));

    render(<PendingSequenceModal />);
    submit();
    expect(document.activeElement).toBe(tokenInput());
  });
});
