import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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

/** Stubs `[data-shell-body]` in the DOM with a fixed measured top, mimicking
 * the row below TitleBar (+ optional EmailVerificationBanner) in DesktopShell. */
function stubShellBody(top: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-shell-body", "");
  el.getBoundingClientRect = () =>
    ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => {} }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.querySelectorAll("[data-shell-body]").forEach((el) => el.remove());
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

  it("docks below the measured shell-body top when pinned", async () => {
    stubShellBody(62);
    mockDeps(true);
    render(<AiDrawer open={true} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("dialog").style.top).toBe("62px"));
  });

  it("stays full-height (top: 0) as an overlay when not pinned", async () => {
    stubShellBody(62);
    mockDeps(false);
    render(<AiDrawer open={true} onClose={vi.fn()} />);

    // Give the async pin-load a tick; overlay mode must never adopt the shell-body top.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("dialog").style.top).toBe("0px");
  });
});
