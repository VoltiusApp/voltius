import { describe, test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, string>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("./hooks", () => ({
  useConnectionSteps: () => ({ steps: [], visible: true }),
  useHostKeyConflict: () => ({ conflict: null, resolving: false, resolveConflict: vi.fn() }),
}));
vi.mock("./AuthPromptPanel", () => ({
  AuthPromptPanel: ({ initialMode, repairVia }: { initialMode?: string; repairVia?: string }) => <div data-testid="auth-prompt">{`${initialMode}:${repairVia}`}</div>,
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import ConnectionOverlay from "./ConnectionOverlay";

const issue = { connectionId: "c1", connectionName: "db-01", via: "pick" as const, reason: "missing" as const, hasFallback: true, fallbackName: "ops-deploy" };
const props = {
  sessionId: "s1", connectionId: "c1", name: "db-01", icon: "lucide:monitor", steps: [], stepEventName: "ssh-step-s1",
  onRetryWithAuth: vi.fn(), onRetry: vi.fn(), onDismiss: vi.fn(), onUseHostCredential: vi.fn(),
} as const;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("identity pick unavailable", () => {
  test("outranks the no-auth prompt and offers the host credential once", () => {
    render(<ConnectionOverlay {...props} status="error" errorMessage="No authentication method provided" identityPick={issue} />);

    expect(screen.queryByTestId("auth-prompt")).toBeNull();
    expect(screen.getByText("terminal.overlay.identityPick.title")).toBeTruthy();
    fireEvent.click(screen.getByText(`terminal.overlay.identityPick.useHostNamed:${JSON.stringify({ name: "ops-deploy" })}`));
    expect(props.onUseHostCredential).toHaveBeenCalledOnce();
  });

  test("without a fallback there is no host option", () => {
    render(<ConnectionOverlay {...props} status="error" identityPick={{ ...issue, hasFallback: false, fallbackName: undefined }} />);
    expect(screen.queryByText(/useHost/)).toBeNull();
  });

  test("choose another identity opens the auth prompt on the identity tab, repairing the broken choice", () => {
    render(<ConnectionOverlay {...props} status="error" identityPick={issue} />);
    fireEvent.click(screen.getByText("terminal.overlay.identityPick.choose"));
    expect(screen.getByTestId("auth-prompt").textContent).toBe("identity:pick");
  });

  test("an issue on a jump host only offers Cancel", () => {
    render(<ConnectionOverlay {...props} status="error" identityPick={{ ...issue, connectionId: "jump-1", connectionName: "bastion" }} />);
    expect(screen.queryByText("terminal.overlay.identityPick.choose")).toBeNull();
    expect(screen.queryByText(/useHost/)).toBeNull();
    fireEvent.click(screen.getByText("common.action.cancel"));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  test("a forbidden pick names the identity", () => {
    render(<ConnectionOverlay {...props} status="error" identityPick={{ ...issue, reason: "forbidden", identityName: "ops-root" }} />);
    expect(screen.getByText(`terminal.overlay.identityPick.forbiddenBody:${JSON.stringify({ identity: "ops-root", host: "db-01" })}`)).toBeTruthy();
  });
});
