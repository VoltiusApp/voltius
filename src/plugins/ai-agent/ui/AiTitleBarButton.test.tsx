import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useAgentStore } from "../state/agentStore";
import { useUIStore } from "@/stores/uiStore";
import { AiTitleBarButton } from "./AiTitleBarButton";

// @iconify/react schedules an async icon-data-load timer that can fire after
// this file's jsdom environment is torn down, touching `window` and surfacing
// as an unhandled error unrelated to any assertion here. Stub it out.
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

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
    useAgentStore.setState({ pendingApprovals: [{ id: "a", tool: "run_command", args: {}, host: "h", grants: [], resolve: () => {} }] });
    render(<AiTitleBarButton />);
    expect(screen.getByTestId("ai-pending-badge")).toBeTruthy();
  });
});
