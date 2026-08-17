import { describe, test, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("./hooks", () => ({
  useConnectionSteps: () => ({ steps: [], visible: true }),
  useHostKeyConflict: () => ({ conflict: null, resolving: false, resolveConflict: vi.fn() }),
}));
vi.mock("./AuthPromptPanel", () => ({
  AuthPromptPanel: () => <div data-testid="auth-prompt" />,
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import ConnectionOverlay from "./ConnectionOverlay";

const props = {
  sessionId: "s1",
  name: "srv",
  icon: "lucide:monitor",
  steps: [],
  stepEventName: "ssh-step-s1",
  onRetryWithAuth: vi.fn(),
  onRetry: vi.fn(),
  onDismiss: vi.fn(),
} as const;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("connection overlay vault failures", () => {
  test("a no-auth failure still asks for credentials", () => {
    render(<ConnectionOverlay {...props} status="error" errorMessage="No authentication method provided" />);

    expect(screen.getByTestId("auth-prompt")).toBeTruthy();
  });

  // The vault holds the password; asking the user to retype it is the bug.
  test("an unreadable vault offers to unlock instead of asking for credentials", () => {
    render(
      <ConnectionOverlay
        {...props}
        status="error"
        errorMessage="No authentication method provided"
        errorCode="vault-unreadable"
      />,
    );

    expect(screen.queryByTestId("auth-prompt")).toBeNull();
    expect(screen.getByText("terminal.overlay.vaultError.unreadableTitle")).toBeTruthy();
  });

  test("a locked vault gets its own wording", () => {
    render(<ConnectionOverlay {...props} status="error" errorMessage="Vault is locked" errorCode="vault-locked" />);

    expect(screen.queryByTestId("auth-prompt")).toBeNull();
    expect(screen.getByText("terminal.overlay.vaultError.lockedTitle")).toBeTruthy();
  });
});
