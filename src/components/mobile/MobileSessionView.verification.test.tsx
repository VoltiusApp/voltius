import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TerminalSession } from "@/types";
import MobileSessionView from "./MobileSessionView";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/components/terminal/SessionView", async (original) => ({
  ...await original<typeof import("@/components/terminal/SessionView")>(),
  HostAwareTerminalView: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const url = "https://login.tailscale.com/a/test";
const session: TerminalSession = {
  id: "s", connectionId: "host", connectionName: "host", type: "ssh", status: "connecting",
};
const check = {
  state: "verify" as const, url, autoOpen: true,
  banner: `# Tailscale SSH requires an additional check.\n# To authenticate, visit: ${url}`,
};

it("inserts the server's check between authentication and opening the shell", () => {
  const view = (auth?: TerminalSession["tailscaleAuth"]) =>
    <MobileSessionView session={{ ...session, tailscaleAuth: auth }} visible={false} active={false} />;
  const { rerender, getByRole, getByText, queryByRole, getAllByRole } = render(view());
  expect(queryByRole("link")).toBeNull();
  expect(queryByRole("status")).toBeNull();

  const banner = check.banner + "\n<img src=x> https://other.example/";
  rerender(view({ ...check, banner }));
  const auth = getByText("Authenticating");
  const shell = getByText("Opening shell");
  const prompt = getByRole("status");
  expect(auth.closest('[aria-current="step"]')).toBeTruthy();
  expect(auth.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(prompt.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const link = getByRole("link", { name: url });
  expect(link.closest("p")?.textContent).toBe(banner);
  expect(getAllByRole("link")).toHaveLength(1);
  expect(link.closest("p")?.querySelector("img")).toBeNull();
  expect(link.getAttribute("href")).toBe(url);
  fireEvent.click(link);
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);

  rerender(view());
  expect(queryByRole("link")).toBeNull();
  expect(queryByRole("status")).toBeNull();
});

it("the selected connecting tab opens its check when the phone returns to Voltius", () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  try {
    const view = (visible: boolean) => <MobileSessionView session={{ ...session, tailscaleAuth: check }} visible={visible} active={false} />;
    const { rerender } = render(view(false));
    rerender(view(true));
    expect(openUrl).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
    rerender(view(false));
    rerender(view(true));
    expect(openUrl).toHaveBeenCalledTimes(1);
  } finally {
    visibility.mockRestore();
  }
});
