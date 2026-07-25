import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAgentStore } from "../state/agentStore";
import { ContextChip } from "./ContextChip";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { count?: number }) => (o?.count != null ? `${o.count} lines` : k) }),
}));
// agentStore now imports auditSeam, whose real chain reaches @/i18n's
// `i18n.use(initReactI18next)` — incompatible with this file's partial
// react-i18next mock. This test exercises rendering only, not auditing.
vi.mock("../state/auditSeam", () => ({ auditAgentAction: vi.fn() }));

afterEach(() => { cleanup(); useAgentStore.setState({ pendingContext: null }); });

const ctx = (over: Partial<{ source: "selection" | "snapshot"; truncated: boolean }> = {}) => ({
  sessionId: "s1", connectionName: "Prod DB", source: "selection" as const, text: "boom",
  lineCount: 12, truncated: false, ...over,
});

describe("ContextChip", () => {
  it("renders nothing when no context is staged", () => {
    const { container } = render(<ContextChip />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the connection, source and line count", () => {
    useAgentStore.setState({ pendingContext: ctx() });
    render(<ContextChip />);
    expect(screen.getByText(/Prod DB/)).toBeTruthy();
    expect(screen.getByText(/12 lines/)).toBeTruthy();
    expect(screen.getByText(/chip\.selection/)).toBeTruthy();
  });

  it("marks a truncated snapshot attachment", () => {
    useAgentStore.setState({ pendingContext: ctx({ source: "snapshot", truncated: true }) });
    render(<ContextChip />);
    expect(screen.getByText(/chip\.snapshot/)).toBeTruthy();
    expect(screen.getByText(/chip\.truncated/)).toBeTruthy();
  });

  it("clears the staged context when × is clicked", async () => {
    useAgentStore.setState({ pendingContext: ctx() });
    render(<ContextChip />);
    await userEvent.click(screen.getByRole("button", { name: "aiAgent.touchpoint.chip.remove" }));
    expect(useAgentStore.getState().pendingContext).toBeNull();
  });
});
