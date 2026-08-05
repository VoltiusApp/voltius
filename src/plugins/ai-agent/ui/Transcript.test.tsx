import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Transcript } from "./Transcript";
import { useAgentStore } from "../state/agentStore";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
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
