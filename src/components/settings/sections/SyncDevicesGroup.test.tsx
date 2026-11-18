import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockT } = vi.hoisted(() => ({
  mockT: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
vi.mock("@/i18n", () => ({ default: { t: mockT } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const h = vi.hoisted(() => ({ retry: vi.fn(async () => {}), remove: vi.fn(async () => {}), toast: vi.fn() }));
vi.mock("@/services/sync", () => ({
  retryRemoteSources: h.retry,
  removeRemoteSource: h.remove,
  onRemotePayloadMerged: () => () => {},
  getDeviceId: async () => "self",
}));
vi.mock("@/services/appToast", () => ({ appToast: h.toast }));

import { remoteSources } from "@/services/remoteSources";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { SyncDevicesGroup } from "./SyncDevicesGroup";

const v = (device_id: string) => ({ device_id, updated_at: "2030-01-01T00:00:00.000Z" });
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-sync-device]")];

beforeEach(() => {
  remoteSources.clear();
  remoteSources.track([v("aaaaaaaa-laptop"), v("bbbbbbbb-old")]);
  remoteSources.succeeded(v("aaaaaaaa-laptop"));
  remoteSources.failed(v("bbbbbbbb-old"), "undecryptable");
  useCrossDeviceSessionsStore.setState({ manifests: { "aaaaaaaa-laptop": { deviceName: "laptop" } as never } });
  h.retry.mockClear();
  h.remove.mockReset().mockResolvedValue(undefined);
  h.toast.mockClear();
});
afterEach(cleanup);

describe("SyncDevicesGroup", () => {
  test("lists failing devices first, named from what this device knows", () => {
    render(<SyncDevicesGroup />);
    expect(rows().map((r) => [r.dataset.syncDevice, r.dataset.state])).toEqual([
      ["bbbbbbbb-old", "undecryptable"],
      ["aaaaaaaa-laptop", "synced"],
    ]);
    expect(rows()[0].textContent).toContain('settings.sync.devices.unnamed:{"id":"bbbbbbbb"}');
    expect(rows()[0].textContent).toContain("settings.sync.devices.hint.undecryptable");
    expect(rows()[1].textContent).toContain("laptop");
    expect(rows()[1].textContent).not.toContain("settings.sync.devices.hint");
  });

  test("an empty account says so", () => {
    remoteSources.clear();
    render(<SyncDevicesGroup />);
    expect(screen.getByText("settings.sync.devices.empty")).toBeTruthy();
  });

  test("retry re-syncs that one device, and is greyed out where nothing failed", () => {
    render(<SyncDevicesGroup />);
    fireEvent.click(rows()[0].querySelector("[data-device-retry]")!);
    expect(h.retry).toHaveBeenCalledWith(["bbbbbbbb-old"]);
    const synced = rows()[1].querySelector<HTMLButtonElement>("[data-device-retry]")!;
    expect(synced.disabled).toBe(true);
    expect(synced.title).toBe("settings.sync.devices.retryNone");
  });

  test("remove asks first, then deletes", async () => {
    render(<SyncDevicesGroup />);
    fireEvent.click(rows()[0].querySelector("[data-device-remove]")!);
    expect(h.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByText("settings.sync.devices.remove").slice(-1)[0]);
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith("bbbbbbbb-old"));
  });

  test("a failed removal shows why", async () => {
    h.remove.mockRejectedValue(new Error("HTTP 500"));
    render(<SyncDevicesGroup />);
    fireEvent.click(rows()[0].querySelector("[data-device-remove]")!);
    fireEvent.click(screen.getAllByText("settings.sync.devices.remove").slice(-1)[0]);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("error", expect.stringContaining("HTTP 500")));
  });
});
