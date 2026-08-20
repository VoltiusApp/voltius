import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { USER_DATA_HANDLERS } from "@/services/user-data/registry";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/utils/billing", () => ({ openPortal: vi.fn() }));
vi.mock("@/services/sync", () => ({
  getSyncState: () => ({ status: "idle", lastSync: null, error: null, cloudActive: false, blobSizeBytes: null }),
  onSyncStateChange: () => () => {},
  syncNow: vi.fn(),
  scheduleSync: vi.fn(),
}));

import { scheduleSync } from "@/services/sync";
import SyncSection from "./SyncSection";

const toggleFor = (c: HTMLElement, domain: string) =>
  c.querySelector(`[data-sync-domain="${domain}"] button[role="switch"]`) as HTMLButtonElement | null;

describe("SyncSection settings domains", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {}, syncTypes: {}, excludedIds: [] }));
  afterEach(cleanup);

  test("renders a toggle for each settings domain and none for vaults", () => {
    const { container } = render(<SyncSection />);
    expect(toggleFor(container, "themes")).toBeTruthy();
    expect(toggleFor(container, "appSettings")).toBeTruthy();
    expect(toggleFor(container, "recentPeople")).toBeTruthy();
    expect(toggleFor(container, "vaults")).toBeNull();
  });

  test("switching a domain off records it", () => {
    const { container } = render(<SyncSection />);
    fireEvent.click(toggleFor(container, "themes")!);
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(false);
  });

  test("switching a domain back on publishes this device's values", () => {
    const themes = USER_DATA_HANDLERS.find((h) => h.key === "themes")!;
    const touch = vi.spyOn(themes, "touch").mockImplementation(() => {});
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    const { container } = render(<SyncSection />);
    fireEvent.click(toggleFor(container, "themes")!);
    expect(touch).toHaveBeenCalled();
    touch.mockRestore();
  });

  test("switching a domain off does not touch it", () => {
    const themes = USER_DATA_HANDLERS.find((h) => h.key === "themes")!;
    const touch = vi.spyOn(themes, "touch").mockImplementation(() => {});
    const { container } = render(<SyncSection />);
    fireEvent.click(toggleFor(container, "themes")!);
    expect(touch).not.toHaveBeenCalled();
    touch.mockRestore();
  });

  test("switching a domain off schedules a push to withdraw the server copy", () => {
    const { container } = render(<SyncSection />);
    fireEvent.click(toggleFor(container, "themes")!);
    expect(scheduleSync).toHaveBeenCalled();
  });
});
