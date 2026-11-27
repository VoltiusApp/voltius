import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TerminalSession } from "@/types";
import MobileSessionView from "./MobileSessionView";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/components/terminal/SessionView", async (original) => ({
  ...await original<typeof import("@/components/terminal/SessionView")>(),
  HostAwareTerminalView: () => null,
}));

it("the selected connecting tab opens its check when the phone returns to Voltius", () => {
  const url = "https://login.tailscale.com/a/test";
  const session: TerminalSession = {
    id: "s", connectionId: "host", connectionName: "host", type: "ssh", status: "connecting",
    tailscaleAuth: { state: "verify", url, autoOpen: true },
  };
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  try {
    const view = (visible: boolean) => <MobileSessionView session={session} visible={visible} active={false} />;
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
