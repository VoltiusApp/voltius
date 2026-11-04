import { describe, test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("./hooks", () => ({
  useConnectionSteps: () => ({ steps: [], visible: true }),
  useHostKeyConflict: () => ({ conflict: null, resolving: false, resolveConflict: vi.fn() }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import ConnectionOverlay from "./ConnectionOverlay";

const props = {
  sessionId: "s1",
  name: "olt",
  icon: "lucide:monitor",
  steps: [],
  stepEventName: "ssh-step-s1",
  status: "error",
  errorMessage: "translated",
  onRetry: vi.fn(),
  onDismiss: vi.fn(),
  onEnableLegacyAlgorithms: vi.fn(),
} as const;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("connection overlay legacy algorithms", () => {
  test("a server that needs legacy algorithms gets a one-click fix in place of Retry", () => {
    render(<ConnectionOverlay {...props} errorCode="ssh-legacy-algorithms-required" />);

    expect(screen.queryByText("terminal.overlay.connectionError.retry")).toBeNull();
    fireEvent.click(screen.getByText("terminal.overlay.connectionError.enableLegacyAndRetry"));
    expect(props.onEnableLegacyAlgorithms).toHaveBeenCalledOnce();
    expect(props.onRetry).not.toHaveBeenCalled();
  });

  test("algorithms the toggle cannot add keep the plain Retry", () => {
    render(<ConnectionOverlay {...props} errorCode="ssh-no-common-algorithm" />);

    expect(screen.queryByText("terminal.overlay.connectionError.enableLegacyAndRetry")).toBeNull();
    fireEvent.click(screen.getByText("terminal.overlay.connectionError.retry"));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  test("a pane that cannot save the host keeps the plain Retry", () => {
    render(
      <ConnectionOverlay {...props} errorCode="ssh-legacy-algorithms-required" onEnableLegacyAlgorithms={undefined} />,
    );

    expect(screen.getByText("terminal.overlay.connectionError.retry")).toBeTruthy();
  });
});
