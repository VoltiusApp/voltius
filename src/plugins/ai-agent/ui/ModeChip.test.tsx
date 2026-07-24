import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useAgentStore } from "../state/agentStore";
import { ModeChip } from "./ModeChip";

afterEach(cleanup);

describe("ModeChip", () => {
  beforeEach(() => useAgentStore.setState({ mode: "ask" }));
  it("cycles mode on click", () => {
    render(<ModeChip />);
    fireEvent.click(screen.getByRole("button"));
    expect(useAgentStore.getState().mode).toBe("auto");
  });
});
