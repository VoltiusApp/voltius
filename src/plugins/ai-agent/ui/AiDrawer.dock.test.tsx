import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { AiDrawer } from "./AiDrawer";
import * as storeMod from "../state/agentStore";
import { useUIStore } from "@/stores/uiStore";

function mockDeps(pinned: boolean) {
  vi.spyOn(storeMod, "getAgentDeps").mockReturnValue({
    api: {
      storage: {
        get: <T,>(key: string) =>
          Promise.resolve<T | null>((key === "drawerPinned" ? pinned : null) as T | null),
        set: vi.fn(),
      },
    },
    profiles: {
      getActiveId: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
    },
  } as never);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AiDrawer docking", () => {
  beforeEach(() => {
    useUIStore.setState({ dockedPanelWidth: 0 });
  });

  it("reserves shell width when open and pinned", async () => {
    mockDeps(true);
    render(<AiDrawer open={true} onClose={vi.fn()} />);

    await waitFor(() => expect(useUIStore.getState().dockedPanelWidth).toBe(380));
  });

  it("does not reserve width when open but unpinned", async () => {
    mockDeps(false);
    render(<AiDrawer open={true} onClose={vi.fn()} />);

    // Let the pin-loading effect settle; width should remain 0 throughout.
    await new Promise((r) => setTimeout(r, 0));
    expect(useUIStore.getState().dockedPanelWidth).toBe(0);
  });

  it("resets to 0 on unmount while pinned+open", async () => {
    mockDeps(true);
    const { unmount } = render(<AiDrawer open={true} onClose={vi.fn()} />);

    await waitFor(() => expect(useUIStore.getState().dockedPanelWidth).toBe(380));

    unmount();
    expect(useUIStore.getState().dockedPanelWidth).toBe(0);
  });

  it("resets to 0 when closed while pinned", async () => {
    mockDeps(true);
    const { rerender } = render(<AiDrawer open={true} onClose={vi.fn()} />);

    await waitFor(() => expect(useUIStore.getState().dockedPanelWidth).toBe(380));

    rerender(<AiDrawer open={false} onClose={vi.fn()} />);
    expect(useUIStore.getState().dockedPanelWidth).toBe(0);
  });
});
