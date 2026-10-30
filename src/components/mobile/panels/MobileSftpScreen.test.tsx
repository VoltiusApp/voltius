import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

vi.mock("@/services/deviceFiles", () => ({ connectDevice: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/services/myDevices", async (orig) => ({
  ...(await orig<typeof import("@/services/myDevices")>()),
  useMyDevices: () => [{ deviceId: "d1", deviceKey: "k", name: "Work PC", platform: "windows", state: "ready", route: "lan", lastSeen: null }],
}));

afterEach(cleanup);

describe("MobileSftpScreen", () => {
  test("mounts the notification bell in the panel header's right slot", async () => {
    const { default: MobileSftpScreen } = await import("./MobileSftpScreen");
    const { container } = render(<MobileSftpScreen asTab />);
    expect(container.querySelector('[title="notifications.bell.title"]')).not.toBeNull();
  });

  test("shows a failed transfer's error instead of dropping the row", async () => {
    const { default: MobileSftpScreen } = await import("./MobileSftpScreen");
    const { useTransferQueueStore } = await import("@/stores/transferQueueStore");
    useTransferQueueStore.setState({
      transfers: [{
        id: "t1", label: "notes.txt", direction: "←", transferred: 0, total: 0,
        status: "error", error: "Cannot create temp dir: Permission denied (os error 13)",
        settled: true,
      }],
    });
    const { container } = render(<MobileSftpScreen asTab />);
    const row = container.querySelector('[data-sftp-transfer="t1"]');
    expect(row).not.toBeNull();
    expect(row?.querySelector("[data-sftp-transfer-error]")?.textContent).toContain("Permission denied");
    useTransferQueueStore.setState({ transfers: [] });
  });

  test("shows one pane by default; the top-bar toggle adds the second and is remembered", async () => {
    const { default: MobileSftpScreen } = await import("./MobileSftpScreen");
    const { useUIStore } = await import("@/stores/uiStore");
    useUIStore.setState({ mobileSftpTwoPanes: false });
    const { container } = render(<MobileSftpScreen asTab />);
    expect(container.querySelectorAll("[data-sftp-pane]").length).toBe(1);
    expect(container.querySelector("[data-sftp-copy]")).toBeNull();
    fireEvent.click(container.querySelector("[data-sftp-two-panes]")!);
    expect(container.querySelectorAll("[data-sftp-pane]").length).toBe(2);
    expect(container.querySelector("[data-sftp-copy]")).not.toBeNull();
    expect(useUIStore.getState().mobileSftpTwoPanes).toBe(true);
    useUIStore.setState({ mobileSftpTwoPanes: false });
  });

  test("a read-only device is marked and its create button is disabled", async () => {
    const { default: MobileSftpScreen } = await import("./MobileSftpScreen");
    const { connectDevice } = await import("@/services/deviceFiles");
    vi.mocked(connectDevice).mockResolvedValueOnce({ sftpId: "s-ro", rttMs: 2, readOnly: true });
    const view = render(<MobileSftpScreen asTab />);
    fireEvent.click(view.container.querySelector("[data-sftp-pick-host]")!);
    fireEvent.click(await view.findByText("Work PC"));
    await vi.waitFor(() => expect(view.container.querySelector("[data-read-only-badge]")).not.toBeNull());
    const create = view.container.querySelector("[data-sftp-create]") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.title).toContain("fileTransfer.myDevices.readOnlyShare");
  });

  test("re-showing the tab keeps a device in pane A instead of the active session's host", async () => {
    const { default: MobileSftpScreen } = await import("./MobileSftpScreen");
    const { useSessionStore } = await import("@/stores/sessionStore");
    const { useConnectionStore } = await import("@/stores/connectionStore");
    useConnectionStore.setState({ connections: [{ id: "c1", name: "ssh-box", host: "h", port: 22, username: "u", vault_id: "personal" } as never] });
    useSessionStore.setState({ sessions: [{ id: "s1", connectionId: "c1" } as never], activeSessionId: "s1" });
    const view = render(<MobileSftpScreen asTab visible={false} />);
    fireEvent.click(view.container.querySelector("[data-sftp-pick-host]")!);
    fireEvent.click(await view.findByText("Work PC"));
    const host = () => view.container.querySelector("[data-sftp-pane-host]")?.textContent;
    expect(host()).toContain("Work PC");
    view.rerender(<MobileSftpScreen asTab visible />);
    expect(host()).toContain("Work PC");
  });
});
