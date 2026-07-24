import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useAgentStore } from "../state/agentStore";
import { useUIStore } from "@/stores/uiStore";
import { AiTitleBarButton } from "./AiTitleBarButton";

afterEach(cleanup);

describe("AiTitleBarButton", () => {
  beforeEach(() => {
    useAgentStore.setState({ runStatus: "idle", pendingApprovals: [] });
    useUIStore.setState({ globalPanelOpen: {} });
  });
  it("toggles the drawer open on click", () => {
    render(<AiTitleBarButton />);
    fireEvent.click(screen.getByRole("button"));
    expect(useUIStore.getState().globalPanelOpen["plugin-ai-agent:drawer"]).toBe(true);
  });
  it("shows a pending badge when approvals are queued", () => {
    useAgentStore.setState({ pendingApprovals: [{ id: "a", tool: "run_command", args: {}, host: "h", allowlistKey: "x", resolve: () => {} }] });
    render(<AiTitleBarButton />);
    expect(screen.getByTestId("ai-pending-badge")).toBeTruthy();
  });
});
