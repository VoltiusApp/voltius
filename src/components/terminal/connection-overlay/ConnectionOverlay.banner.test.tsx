import { describe, test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

const h = vi.hoisted(() => ({ conflict: null as null | object }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("./hooks", () => ({
  useConnectionSteps: () => ({ steps: [], visible: true }),
  useHostKeyConflict: () => ({ conflict: h.conflict, resolving: false, resolveConflict: vi.fn() }),
}));
vi.mock("./HostKeyConflictPanel", () => ({ HostKeyConflictPanel: () => <div data-testid="conflict" /> }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import ConnectionOverlay from "./ConnectionOverlay";

const props = {
  sessionId: "s1",
  name: "srv",
  icon: "lucide:monitor",
  steps: [],
  stepEventName: "ssh-step-s1",
  onRetry: vi.fn(),
  onRetryNow: vi.fn(),
  onDismiss: vi.fn(),
  variant: "banner",
} as const;

const banner = (c: HTMLElement) => c.querySelector("[data-reconnect-banner]");

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.conflict = null;
});

describe("reconnect banner", () => {
  test("a reconnect with nothing to ask shows the slim bar, not the full overlay", () => {
    const { container } = render(<ConnectionOverlay {...props} status="connecting" />);
    expect(banner(container)?.textContent).toContain("terminal.overlay.reconnectBanner.reconnecting");
  });

  test("Close tab dismisses; Retry now shows only while the host is slow to answer", () => {
    const { container, rerender } = render(<ConnectionOverlay {...props} status="connecting" reconnectWait="offline" />);
    expect(container.textContent).not.toContain("terminal.overlay.reconnectWait.retryNow");
    rerender(<ConnectionOverlay {...props} status="connecting" reconnectWait="slow" />);
    const buttons = [...container.querySelectorAll("button")];
    fireEvent.click(buttons.find((b) => b.textContent === "terminal.overlay.reconnectWait.retryNow")!);
    fireEvent.click(buttons.find((b) => b.textContent === "terminal.overlay.reconnectBanner.closeTab")!);
    expect(props.onRetryNow).toHaveBeenCalled();
    expect(props.onDismiss).toHaveBeenCalled();
  });

  test("a host-key conflict during the reconnect still takes the full overlay", () => {
    h.conflict = { host: "srv" };
    const { container, getByTestId } = render(<ConnectionOverlay {...props} status="connecting" />);
    expect(banner(container)).toBeNull();
    expect(getByTestId("conflict")).toBeTruthy();
  });

  test("a failed reconnect shows the full error overlay", () => {
    const { container } = render(<ConnectionOverlay {...props} status="error" errorMessage="Connection refused" />);
    expect(banner(container)).toBeNull();
    expect(container.textContent).toContain("terminal.overlay.connectionError.title");
  });
});
