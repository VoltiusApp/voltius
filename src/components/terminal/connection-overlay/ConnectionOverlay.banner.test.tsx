import { describe, test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
  writeClipboard: vi.fn(async (_text: string) => {}),
  conflict: null as null | object,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("./hooks", () => ({
  useConnectionSteps: () => ({ steps: [], visible: true }),
  useHostKeyConflict: () => ({ conflict: h.conflict, resolving: false, resolveConflict: vi.fn() }),
}));
vi.mock("./HostKeyConflictPanel", () => ({ HostKeyConflictPanel: () => <div data-testid="conflict" /> }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: h.writeClipboard }));
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

  test.each([undefined, "banner"] as const)("browser verification waits for a click (%s)", (variant) => {
    const url = "https://login.tailscale.com/a/test";
    const { getByRole, queryByRole, rerender } = render(
      <ConnectionOverlay {...props} variant={variant} status="connecting" verificationUrl={url} />,
    );
    const verify = { name: "terminal.overlay.tailscaleCheck.open" };
    expect(h.openUrl).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", verify));
    expect(h.openUrl).toHaveBeenCalledExactlyOnceWith(url);
    fireEvent.click(getByRole("button", { name: "terminal.overlay.tailscaleCheck.copy" }));
    expect(h.writeClipboard).toHaveBeenCalledExactlyOnceWith(url);
    fireEvent.click(getByRole("button", { name: "common.action.cancel" }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
    rerender(<ConnectionOverlay {...props} variant={variant} status="connected" verificationUrl={url} />);
    expect(queryByRole("button", verify)).toBeNull();
  });

  test("a failed reconnect shows the full error overlay", () => {
    const { container } = render(<ConnectionOverlay {...props} status="error" errorMessage="Connection refused" />);
    expect(banner(container)).toBeNull();
    expect(container.textContent).toContain("terminal.overlay.connectionError.title");
  });
});

describe("NetBird SSH sign-in", () => {
  test.each(["overlay", "banner"] as const)("saves setup to the host and shows the device code in the %s view", async (variant) => {
    const login = vi.fn();
    const { getByLabelText, getByRole, findByRole, getByText, rerender } = render(
      <ConnectionOverlay {...props} variant={variant} connectionId="c1" status="error"
        errorCode="ssh-netbird-sso-required" onNetbirdLogin={login} />,
    );
    const body = "A".repeat(43);
    const submit = getByRole("button", { name: "terminal.overlay.netbird.signIn" }) as HTMLButtonElement;
    const issuer = getByLabelText("connections.netbird.issuer");
    fireEvent.change(issuer, { target: { value: "https://id.example?secret=bad" } });
    fireEvent.change(getByLabelText("connections.netbird.clientId"), { target: { value: " public " } });
    fireEvent.change(getByLabelText("connections.netbird.fingerprint"), { target: { value: `sha256:${body}=` } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(issuer, { target: { value: "https://id.example/tenant" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(login).toHaveBeenCalledWith({ issuer: "https://id.example/tenant", client_id: "public",
      fingerprint: `SHA256:${body}`, scope: "openid profile email", audience: "", token_type: "access_token" });

    const challenge = { verificationUri: "https://id.example/device", userCode: "ABCD" };
    rerender(<ConnectionOverlay {...props} variant={variant} status="connecting" netbirdChallenge={challenge} />);
    expect(getByText(challenge.userCode)).toBeTruthy();
    expect(getByText(challenge.verificationUri)).toBeTruthy();
    expect(h.openUrl).not.toHaveBeenCalled();
    h.openUrl.mockRejectedValueOnce(new Error("no browser"));
    fireEvent.click(getByRole("button", { name: "terminal.overlay.netbird.open" }));
    expect(h.openUrl).toHaveBeenCalledWith(challenge.verificationUri);
    expect((await findByRole("alert")).textContent).toBe("terminal.overlay.netbird.manual");
    fireEvent.click(getByRole("button", { name: "common.action.cancel" }));
    expect(props.onDismiss).toHaveBeenCalled();
  });

  test("prefills the host's saved settings", () => {
    const netbird = { issuer: "https://id.example", client_id: "public", scope: "openid", audience: "nb",
      token_type: "id_token" as const, fingerprint: "SHA256:" + "B".repeat(43) };
    const { getByLabelText } = render(
      <ConnectionOverlay {...props} status="error" errorCode="ssh-netbird-sso-required" netbird={netbird} onNetbirdLogin={vi.fn()} />,
    );
    expect((getByLabelText("connections.netbird.audience") as HTMLInputElement).value).toBe("nb");
  });
});
