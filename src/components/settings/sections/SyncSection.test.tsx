import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { USER_DATA_HANDLERS } from "@/services/user-data/registry";

const { mockT } = vi.hoisted(() => ({
  mockT: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
vi.mock("@/i18n", () => ({ default: { t: mockT } }));
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

describe("held-back settings summary", () => {
  // The file already mocks react-i18next, @/i18n, @iconify/react and
  // @/services/sync, and queries the DOM directly — jest-dom is not installed.
  const el = (c: HTMLElement, id: string) =>
    c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  beforeEach(() =>
    useSyncPrefsStore.setState({
      syncSettingDomains: {}, settingSyncOverrides: {}, syncTypes: {}, excludedIds: [],
    }),
  );
  afterEach(cleanup);

  test("counts the device-scoped default under App settings", () => {
    const { container } = render(<SyncSection />);
    expect(el(container, "held-back-appSettings")?.textContent).toContain("1");
  });

  test("lists a held-back key and resumes it", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.locale", false);
    const { container } = render(<SyncSection />);
    fireEvent.click(el(container, "held-back-appSettings")!);
    fireEvent.click(el(container, "resume-appSettings.locale")!);
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.locale")).toBe(true);
  });

  test("shows nothing for a domain with no held-back keys", () => {
    const { container } = render(<SyncSection />);
    expect(el(container, "held-back-shortcuts")).toBeNull();
  });

  test("shows nothing for a domain that is switched off entirely", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("appSettings", false);
    const { container } = render(<SyncSection />);
    expect(el(container, "held-back-appSettings")).toBeNull();
  });
});
