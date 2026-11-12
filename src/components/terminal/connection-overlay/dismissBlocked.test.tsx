import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DecisionPanel } from "./DecisionPanel";
import { DismissBlockedContext } from "./dismissBlocked";

const panel = (blocked: string | undefined) =>
  render(
    <DismissBlockedContext.Provider value={blocked}>
      <DecisionPanel tone="secure" icon={null} title="t" description="d" actions={[
        { label: "Connect", variant: "secondary", onClick: vi.fn() },
        { label: "Cancel", variant: "ghost", dismisses: true, onClick: vi.fn() },
      ]} />
    </DismissBlockedContext.Provider>,
  );

describe("cancel actions on a locked tab", () => {
  afterEach(cleanup);
  test("greys out actions that close the tab, with the reason", () => {
    panel("Unlock the tab to close it");
    const cancel = screen.getByText("Cancel") as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(cancel.title).toBe("Unlock the tab to close it");
    expect((screen.getByText("Connect") as HTMLButtonElement).disabled).toBe(false);
  });

  test("leaves them enabled on an unlocked tab", () => {
    panel(undefined);
    expect((screen.getByText("Cancel") as HTMLButtonElement).disabled).toBe(false);
  });
});
