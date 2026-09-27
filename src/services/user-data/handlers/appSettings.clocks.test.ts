import { test, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { appSettingsHandler } from "./appSettings";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useLocaleStore } from "@/stores/localeStore";
import { withRemoteApply } from "@/stores/remoteApplyGuard";

const T1 = "2030-01-01T00:00:00.000Z";
const T2 = "2030-01-02T00:00:00.000Z";
const T3 = "2030-01-03T00:00:00.000Z";

beforeEach(() => {
  useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} });
  useAppSettingsTimestampStore.setState({ updatedAt: T1, clocks: {} });
});

test("edits to different settings on two devices both survive the merge", () => {
  const local = { locale: "fr", terminal: { cursorStyle: "bar" }, clocks: { locale: T2, "terminal.cursorStyle": T1 } };
  const remote = { locale: "tr", terminal: { cursorStyle: "block" }, clocks: { locale: T1, "terminal.cursorStyle": T3 } };

  const { value, updated, updatedAt } = appSettingsHandler.merge(local, remote, T2, T3);

  expect(value).toMatchObject({ locale: "fr", terminal: { cursorStyle: "block" } });
  expect((value as { clocks: Record<string, string> }).clocks).toMatchObject({ locale: T2, "terminal.cursorStyle": T3 });
  expect(updated).toBe(true);
  expect(updatedAt).toBe(T3);
});

test("a peer without per-setting clocks merges as one section stamped with its timestamp", () => {
  const local = { locale: "fr", terminal: { cursorStyle: "bar" }, clocks: { locale: T1, "terminal.cursorStyle": T3 } };
  const remote = { locale: "tr", terminal: { cursorStyle: "block" } };

  const { value } = appSettingsHandler.merge(local, remote, T3, T2);

  expect(value).toMatchObject({ locale: "tr", terminal: { cursorStyle: "bar" } });
});

test("a held-back setting never takes the remote value", () => {
  useSyncPrefsStore.setState({ settingSyncOverrides: { "appSettings.locale": false } });
  const { value, updated } = appSettingsHandler.merge(
    { locale: "fr", clocks: { locale: T1 } },
    { locale: "tr", clocks: { locale: T3 } },
    T1,
    T3,
  );

  expect(value).toMatchObject({ locale: "fr" });
  expect(updated).toBe(false);
});

test("a local edit stamps only its own setting", () => {
  useLocaleStore.getState().setLocale("fr");

  expect(Object.keys(useAppSettingsTimestampStore.getState().clocks)).toEqual(["locale"]);
});

test("a remote apply adopts the merged clocks instead of stamping every applied setting", async () => {
  await withRemoteApply(T3, () => appSettingsHandler.import({ locale: "tr", clocks: { locale: T2 } }));

  expect(useAppSettingsTimestampStore.getState()).toMatchObject({ updatedAt: T3, clocks: { locale: T2 } });
});
