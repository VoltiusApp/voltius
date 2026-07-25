import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/i18n";
import { AiDrawer } from "./AiDrawer";
import * as storeMod from "../state/agentStore";
import { useUIStore } from "@/stores/uiStore";

// @iconify/react schedules an async icon-data-load timer that can fire after
// this file's jsdom environment is torn down, touching `window` and surfacing
// as an unhandled error unrelated to any assertion here. Stub it out.
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

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

/** Stubs `[data-shell-content]` in the DOM with a fixed measured rect, mimicking
 * the MainPanel/RightPanel row in DesktopShell (below TitleBar/VaultHeader/NavBar,
 * beside the sidebar). */
function stubShellContent(top: number, height = 500): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-shell-content", "");
  el.getBoundingClientRect = () =>
    ({ top, left: 0, right: 0, bottom: top + height, width: 0, height, x: 0, y: top, toJSON: () => {} }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.querySelectorAll("[data-shell-content]").forEach((el) => el.remove());
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

  it("docks to the measured shell-content row's top + height when pinned", async () => {
    stubShellContent(62, 500);
    mockDeps(true);
    render(<AiDrawer open={true} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("dialog").style.top).toBe("62px"));
    expect(screen.getByRole("dialog").style.height).toBe("500px");
    expect(screen.getByRole("dialog").style.bottom).toBe("");
  });

  it("stays full-height (top: 0, bottom: 0) as an overlay when not pinned", async () => {
    stubShellContent(62, 500);
    mockDeps(false);
    render(<AiDrawer open={true} onClose={vi.fn()} />);

    // Give the async pin-load a tick; overlay mode must never adopt the shell-content rect.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("dialog").style.top).toBe("0px");
    expect(screen.getByRole("dialog").style.bottom).toBe("0px");
    expect(screen.getByRole("dialog").style.height).toBe("");
  });

  // Regression test for a runtime-only bug: unit tests previously only ever rendered
  // the drawer already-pinned (mocked storage resolving `true` from t=0), which never
  // exercised a genuine post-mount pinned:false -> true transition. Render unpinned
  // first, then flip pinned via the Pin button (mirroring a live user click) and assert
  // BOTH the docked width (global store) and the drawer's own top/height (local
  // measurement) pick up the change — not just one or the other.
  it("picks up both dockedPanelWidth and dock geometry when pinned flips true after mount", async () => {
    stubShellContent(62, 500);
    mockDeps(false);
    render(<AiDrawer open={true} onClose={vi.fn()} />);

    const pinButton = await screen.findByTitle("Pin");
    expect(useUIStore.getState().dockedPanelWidth).toBe(0);
    expect(screen.getByRole("dialog").style.top).toBe("0px");

    await userEvent.click(pinButton);

    await waitFor(() => expect(screen.getByTitle("Unpin")).toBeTruthy());
    await waitFor(() => expect(useUIStore.getState().dockedPanelWidth).toBe(380));
    await waitFor(() => expect(screen.getByRole("dialog").style.top).toBe("62px"));
    expect(screen.getByRole("dialog").style.height).toBe("500px");
  });
});
