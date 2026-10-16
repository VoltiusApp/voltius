import "@/i18n";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSshConfigStore } from "@/stores/sshConfigStore";
import { useVaultStore } from "@/stores/vaultStore";

const request = vi.fn((..._a: unknown[]) => {});
const change = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<typeof import("@/utils/platform")>()), getPlatform: async () => "linux", usePlatform: () => "linux" }));
vi.mock("@/services/sshConfig/sync", () => ({ sshConfigSync: { request: (...a: unknown[]) => request(...a) } }));
vi.mock("@/services/sshConfig/link", () => ({ turnOff: vi.fn(), changeSync: (...a: unknown[]) => change(...a) }));

import { SshConfigGroup } from "./SshConfigGroup";

const mount = async () => { await act(async () => { render(<SshConfigGroup />); }); };

afterEach(cleanup);
beforeEach(() => {
  request.mockClear();
  change.mockClear();
  useVaultStore.setState({ vaults: [] });
  useSshConfigStore.setState({ state: {}, status: { skipped: [] }, dialog: null });
});

describe("SshConfigGroup", () => {
  it("opens the activation preview from the switch", async () => {
    await mount();
    fireEvent.click(screen.getByRole("switch"));
    expect(useSshConfigStore.getState().dialog).toBe("activate");
  });

  it("shows the selected vault even before the vault list loads, and the vault-gone error", async () => {
    useSshConfigStore.setState({ state: { sync: { on: true, vault: "lab", at: 1 } }, status: { skipped: [], error: "vault" } });
    await mount();
    expect(screen.getByText("lab")).toBeTruthy();
    expect(screen.getByText(/no longer exists/i)).toBeTruthy();
    expect(screen.getByText(/Not read yet/)).toBeTruthy();
  });

  it("changes copy keys through the switch", async () => {
    useSshConfigStore.setState({ state: { sync: { on: true, vault: "personal", at: 1 } } });
    await mount();
    fireEvent.click(screen.getByRole("switch", { name: /copy private keys/i }));
    await act(async () => {});
    expect(change).toHaveBeenCalledWith({ copyKeys: false });
  });

  it("asks a computer that has not reviewed its config to review it, and hides the settings it would skip", async () => {
    useSshConfigStore.setState({ state: { sync: { on: true, vault: "personal", at: 1 } }, status: { skipped: [], error: "join" } });
    await mount();
    expect(screen.queryByRole("switch", { name: /copy private keys/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review…" }));
    expect(useSshConfigStore.getState().dialog).toBe("activate");
  });
});
