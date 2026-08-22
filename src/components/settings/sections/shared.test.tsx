import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

// Same mock set as SyncSection.test.tsx: `t` returns the key, Icon renders
// nothing, and @/services/sync is stubbed because syncChoice imports scheduleSync.
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { SettingRow } from "./shared";

// @testing-library/jest-dom is NOT installed in this repo — assert on DOM
// properties, never with toBeDisabled/toHaveTextContent.
const btn = (c: HTMLElement) =>
  c.querySelector('[data-testid="sync-key-button"]') as HTMLButtonElement | null;

const row = (syncKey: string) =>
  render(<SettingRow title="x" syncKey={syncKey}><span /></SettingRow>).container;

describe("SettingRow syncKey", () => {
  beforeEach(() =>
    useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} }),
  );
  afterEach(cleanup);

  test("renders no sync control without the prop", () => {
    const { container } = render(<SettingRow title="x"><span /></SettingRow>);
    expect(btn(container)).toBeNull();
  });

  test("clicking holds the setting back", () => {
    const c = row("appSettings.locale");
    fireEvent.click(btn(c)!);
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.locale")).toBe(false);
  });

  test("clicking again resumes syncing", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.locale", false);
    const c = row("appSettings.locale");
    fireEvent.click(btn(c)!);
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.locale")).toBe(true);
  });

  test("is inert while the whole domain is off", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("appSettings", false);
    const c = row("appSettings.locale");
    expect(btn(c)!.disabled).toBe(true);
    fireEvent.click(btn(c)!);
    expect(useSyncPrefsStore.getState().settingSyncOverrides["appSettings.locale"]).toBeUndefined();
  });

  test("a device-scoped key starts held back", () => {
    const c = row("appSettings.terminal.preferredShell");
    expect(btn(c)!.getAttribute("title")).toBe("settings.sync.keyButton.deviceDefault");
  });
});
