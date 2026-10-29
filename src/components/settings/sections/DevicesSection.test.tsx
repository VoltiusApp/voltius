import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const android = vi.hoisted(() => ({ on: false }));
const saveFileAccess = vi.hoisted(() => vi.fn(async () => {}));
const disconnectDevice = vi.hoisted(() => vi.fn(async () => {}));
const loadFileAccess = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("react-i18next", async (orig) => ({ ...(await orig<object>()), useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@tauri-apps/api/path", () => ({ downloadDir: vi.fn(async () => "/home/me/Downloads") }));
vi.mock("@/services/systemDialog", () => ({ openSystemDialog: vi.fn(async () => "/home/me/Pictures") }));
vi.mock("@/services/deviceFiles", () => ({ saveFileAccess, disconnectDevice, loadFileAccess }));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<object>()),
  useIsAndroid: () => android.on,
  useIsMobile: () => false,
}));

import DevicesSection from "./DevicesSection";
import { useDeviceFilesStore, type FileAccessConfig } from "@/stores/deviceFilesStore";
import { useLanSyncStore } from "@/stores/lanSyncStore";

const base: FileAccessConfig = { enabled: false, folders: [], readOnly: false, allowed: [], seenKeys: [] };

function setup(config: FileAccessConfig | null, known = {}, sessions: { deviceKey: string; deviceName: string; since: string }[] = []) {
  useDeviceFilesStore.setState({ config, sessions });
  useLanSyncStore.setState({ known });
}

const lastSaved = () => (saveFileAccess.mock.calls[saveFileAccess.mock.calls.length - 1] as unknown as [FileAccessConfig])[0];
const lastCall = () => saveFileAccess.mock.calls[saveFileAccess.mock.calls.length - 1] as unknown;

beforeEach(() => {
  android.on = false;
  saveFileAccess.mockClear();
  disconnectDevice.mockClear();
  loadFileAccess.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

const laptop = { name: "MacBook", platform: "macos", lastSeen: "", lastRoute: null, deviceKey: "key-mac" };

describe("DevicesSection", () => {
  test("loads_config_on_mount_without_service", async () => {
    setup(null);
    loadFileAccess.mockImplementation(async () => {
      useDeviceFilesStore.getState().setConfig({ ...base, folders: ["/saved"] });
    });
    render(<DevicesSection />);
    expect(await screen.findByText("/saved")).toBeTruthy();
    expect(loadFileAccess).toHaveBeenCalledTimes(1);
  });

  test("toggle_on_adds_downloads_once", async () => {
    setup(base);
    render(<DevicesSection />);
    fireEvent.click(screen.getByLabelText("settings.devices.fileAccess.enable.title"));
    await waitFor(() => expect(saveFileAccess).toHaveBeenCalled());
    expect(lastSaved()).toMatchObject({ enabled: true, folders: ["/home/me/Downloads"] });

    cleanup();
    saveFileAccess.mockClear();
    setup({ ...base, folders: ["/data"] });
    render(<DevicesSection />);
    fireEvent.click(screen.getByLabelText("settings.devices.fileAccess.enable.title"));
    await waitFor(() => expect(saveFileAccess).toHaveBeenCalled());
    expect(lastSaved()).toMatchObject({ enabled: true, folders: ["/data"] });
  });

  test("read_only_saves_config", () => {
    setup(base);
    render(<DevicesSection />);
    fireEvent.click(screen.getByLabelText("settings.devices.fileAccess.readOnly.title"));
    expect(lastSaved()).toEqual({ ...base, readOnly: true });
  });

  test("always_toggle_writes_allowed_entry_by_key", () => {
    setup(base, { d1: laptop });
    render(<DevicesSection />);
    fireEvent.click(screen.getByLabelText("settings.devices.allowed.alwaysLabel"));
    expect(lastSaved().allowed).toEqual([{ deviceKey: "key-mac", name: "MacBook", always: true, lastOpened: null }]);
  });

  test("always_toggle_off_keeps_entry_and_shows_connected", () => {
    const entry = { deviceKey: "key-mac", name: "MacBook", always: true, lastOpened: null };
    setup({ ...base, allowed: [entry] }, { d1: laptop }, [{ deviceKey: "key-mac", deviceName: "MacBook", since: "" }]);
    render(<DevicesSection />);
    expect(screen.getByText("settings.devices.allowed.connectedNow")).toBeTruthy();
    fireEvent.click(screen.getByText("settings.devices.allowed.disconnect"));
    expect(disconnectDevice).toHaveBeenCalledWith("key-mac");
    fireEvent.click(screen.getByLabelText("settings.devices.allowed.alwaysLabel"));
    expect(lastSaved().allowed).toEqual([{ ...entry, always: false }]);
  });

  test("revoke_removes_entry", () => {
    const entry = { deviceKey: "key-mac", name: "MacBook", always: false, lastOpened: null };
    setup({ ...base, allowed: [entry] }, { d1: laptop });
    render(<DevicesSection />);
    fireEvent.click(screen.getByText("settings.devices.allowed.revoke"));
    expect(lastSaved().allowed).toEqual([]);
  });

  test("device_without_key_cannot_be_preallowed", () => {
    setup(base, { d1: { ...laptop, deviceKey: undefined }, a1: { ...laptop, name: "Pixel", platform: "android" } });
    render(<DevicesSection />);
    expect(screen.getByText("settings.devices.allowed.needsKey")).toBeTruthy();
    expect(screen.queryByText("Pixel")).toBeNull();
    const toggle = screen.getByLabelText("settings.devices.allowed.alwaysLabel");
    expect((toggle as HTMLButtonElement).disabled || toggle.getAttribute("aria-disabled") === "true").toBe(true);
    fireEvent.click(toggle);
    expect(lastCall()).toBeUndefined();
  });

  test("hidden_on_android", () => {
    android.on = true;
    setup(base);
    const { container } = render(<DevicesSection />);
    expect(container.innerHTML).toBe("");
  });

  test("renders_nothing_before_config_loads", () => {
    setup(null);
    const { container } = render(<DevicesSection />);
    expect(container.innerHTML).toBe("");
  });
});
