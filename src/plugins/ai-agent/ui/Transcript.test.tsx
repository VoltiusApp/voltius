import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Transcript } from "./Transcript";
import { useAgentStore } from "../state/agentStore";
import { installFakeI18n } from "../testing/fakeI18n";

installFakeI18n((k: string) => k);

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@voltius/ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConnectionAvatar: () => null,
}));
vi.mock("./ApprovalCard", () => ({ ApprovalCard: () => null }));
vi.mock("./PlanCard", () => ({ PlanCard: () => null }));
vi.mock("./useObjectRefs", () => ({
  useObjectRefs: () => ({ resolve: () => null, knownIds: new Set<string>(), loading: false }),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAgentStore.setState({ transcript: [], pendingApprovals: [], errorText: null }); });

it("renders a short tool result as a one-line pill (no disclosure)", () => {
  useAgentStore.setState({ transcript: [{ kind: "tool", tool: "read_terminal", state: "result", detail: "ok" }], pendingApprovals: [], errorText: null });
  render(<Transcript />);
  expect(screen.getByText("read_terminal")).toBeTruthy();
  expect(document.querySelector("details")).toBeNull();
});

it("renders a long/multiline tool result inside a <details> disclosure", () => {
  useAgentStore.setState({ transcript: [{ kind: "tool", tool: "run_command", state: "result", detail: "line1\nline2\nline3" }], pendingApprovals: [], errorText: null });
  render(<Transcript />);
  expect(document.querySelector("details")).not.toBeNull();
});

it("renders assistant text", () => {
  useAgentStore.setState({ transcript: [{ kind: "assistant", text: "diagnosis here" }], pendingApprovals: [], errorText: null });
  render(<Transcript />);
  expect(screen.getByText("diagnosis here")).toBeTruthy();
});

it("shows a failed tool call as its own row, clamped to the first line", () => {
  const detail = "Invalid input\n{\n  \"path\": [\"steps\"]\n}";
  useAgentStore.setState({
    transcript: [{ kind: "tool", tool: "propose_plan", state: "error", detail }],
    pendingApprovals: [], errorText: null,
  });
  render(<Transcript />);
  expect(screen.getByText("propose_plan")).toBeTruthy();
  expect(screen.getByText("Invalid input")).toBeTruthy();
  // The rest is behind the disclosure, not painted into the row.
  expect(document.querySelector("summary")?.textContent).toBe("propose_planInvalid input");
});

it("summarizes a JSON result instead of dumping it", () => {
  useAgentStore.setState({
    transcript: [{ kind: "tool", tool: "run_command", state: "result", detail: JSON.stringify({ output: "hi", exitCode: 0 }) }],
    pendingApprovals: [], errorText: null,
  });
  render(<Transcript />);
  expect(screen.getByText("exit 0 · hi")).toBeTruthy();
});

it("dismisses the error banner through the store", async () => {
  useAgentStore.setState({ transcript: [], pendingApprovals: [], errorText: "boom" });
  render(<Transcript />);
  screen.getByLabelText("aiAgent.error.dismiss").click();
  expect(useAgentStore.getState().errorText).toBeNull();
});
