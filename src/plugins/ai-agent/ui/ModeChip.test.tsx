import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { useAgentStore } from "../state/agentStore";
import { ModeChip } from "./ModeChip";

afterEach(cleanup);
beforeEach(() => useAgentStore.setState({ mode: "plan", planBatch: null }));

describe("ModeChip", () => {
  it("cycles mode on click", () => {
    useAgentStore.setState({ mode: "ask" });
    render(<ModeChip />);
    fireEvent.click(screen.getByRole("button"));
    expect(useAgentStore.getState().mode).toBe("auto");
  });

  it("shows the plain plan label with no batch", () => {
    render(<ModeChip />);
    expect(screen.queryByText(/runningChip/)).toBeNull();
  });

  it("shows the running-plan state while a batch is live", () => {
    useAgentStore.setState({ planBatch: { generation: 1, planId: "plan-1", tokens: [] } });
    render(<ModeChip />);
    expect(screen.getByText(/aiAgent\.plan\.runningChip/)).toBeTruthy();
  });
});
