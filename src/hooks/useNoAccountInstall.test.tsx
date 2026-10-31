import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ mode: "local" as string | null, platform: "macos" as string | null }));

vi.mock("@/services/account", () => ({ getAccountMode: async () => h.mode }));
vi.mock("@/utils/platform", async () => ({
  ...(await vi.importActual<typeof import("@/utils/platform")>("@/utils/platform")),
  usePlatform: () => h.platform,
}));

import { useNoAccountInstall, useCanPairDevices } from "./useNoAccountInstall";
import { notifyAccountModeChanged } from "@/utils/accountMode";

function Probe() {
  return <span data-testid="p">{`${useNoAccountInstall()}|${useCanPairDevices()}`}</span>;
}
const text = () => document.querySelector("[data-testid=p]")!.textContent;

afterEach(() => {
  cleanup();
  h.mode = "local";
  h.platform = "macos";
});

describe("account-mode hooks", () => {
  test("follow a mode change without remounting", async () => {
    render(<Probe />);
    await waitFor(() => expect(text()).toBe("true|true"));
    h.mode = "server";
    await act(async () => notifyAccountModeChanged());
    await waitFor(() => expect(text()).toBe("false|false"));
    h.mode = "local-nopassword";
    await act(async () => notifyAccountModeChanged());
    await waitFor(() => expect(text()).toBe("true|true"));
  });

  test("stop listening after unmount", async () => {
    const view = render(<Probe />);
    await waitFor(() => expect(text()).toBe("true|true"));
    view.unmount();
    await act(async () => notifyAccountModeChanged());
  });
});
