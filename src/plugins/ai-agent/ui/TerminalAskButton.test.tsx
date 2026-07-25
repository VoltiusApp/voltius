import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAgentStore, _setDeps } from "../state/agentStore";
import { useUIStore } from "@/stores/uiStore";
import { DRAWER_PANEL_ID } from "../panelId";
import { TerminalAskButton } from "./TerminalAskButton";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

afterEach(() => {
  cleanup();
  useAgentStore.setState({ pendingContext: null });
  _setDeps(null);
  useUIStore.setState({ globalPanelOpen: {} });
});

describe("TerminalAskButton", () => {
  it("attaches the built context and opens the drawer on click", async () => {
    const readSelection = vi.fn(() => "boom");
    const readSnapshot = vi.fn(() => "");
    _setDeps({
      api: { terminal: { readSelection, readSnapshot } } as never,
      profiles: {} as never,
      controller: {} as never,
    });
    render(<TerminalAskButton sessionId="s1" connectionName="Prod DB" />);

    await userEvent.click(screen.getByRole("button"));

    expect(useAgentStore.getState().pendingContext).toMatchObject({
      sessionId: "s1", connectionName: "Prod DB", source: "selection", text: "boom",
    });
    expect(useUIStore.getState().globalPanelOpen[DRAWER_PANEL_ID]).toBe(true);
  });

  it("still opens the drawer with no context when buildTerminalContext yields null", async () => {
    const readSelection = vi.fn(() => "");
    const readSnapshot = vi.fn(() => "");
    _setDeps({
      api: { terminal: { readSelection, readSnapshot } } as never,
      profiles: {} as never,
      controller: {} as never,
    });
    render(<TerminalAskButton sessionId="s1" connectionName="Prod DB" />);

    await userEvent.click(screen.getByRole("button"));

    expect(useAgentStore.getState().pendingContext).toBeNull();
    expect(useUIStore.getState().globalPanelOpen[DRAWER_PANEL_ID]).toBe(true);
  });
});
