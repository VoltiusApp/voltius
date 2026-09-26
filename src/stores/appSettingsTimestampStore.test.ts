import { test, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { useSftpSettingsStore } from "./sftpSettingsStore";
import { useTerminalSettingsStore } from "./terminalSettingsStore";
import { useSyncPrefsStore } from "./syncPrefsStore";
import { withRemoteApply } from "./remoteApplyGuard";
import { appSettingsHandler } from "@/services/user-data/handlers/appSettings";
import { hasPath } from "@/utils/dotPath";

const EPOCH = new Date(0).toISOString();
const SHELL = "appSettings.terminal.preferredShell";

function movesClock(write: () => void): boolean {
  useAppSettingsTimestampStore.setState({ updatedAt: EPOCH });
  write();
  return useAppSettingsTimestampStore.getState().updatedAt !== EPOCH;
}

beforeEach(() => {
  // Sync every leaf, including the device-scoped shell, so only the bundle decides.
  useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: { [SHELL]: true } });
});

// Every setter of the two stores that mix synced and device-only values, with
// the leaf it writes. The expectation comes from the bundle itself: a write
// may move the section's clock exactly when appSettings exports that leaf.
const sftp = () => useSftpSettingsStore.getState();
const terminal = () => useTerminalSettingsStore.getState();
const SETTERS: Array<[string, () => void]> = [
  ["sftp.autoRefreshIntervalMs", () => sftp().setAutoRefreshIntervalMs(5000)],
  ["sftp.editorAutoSave", () => sftp().setEditorAutoSave(true)],
  ["sftp.editorMaxBytes", () => sftp().setEditorMaxBytes(1024)],
  ["sftp.showHidden", () => sftp().setShowHidden(true)],
  ["sftp.columnWidths", () => sftp().setColumnWidths((w) => ({ ...w }))],
  ["sftp.visibleColumns", () => sftp().setVisibleColumns((c) => ({ ...c }))],
  ["terminal.preferredShell", () => terminal().setPreferredShell("/bin/zsh")],
  ["terminal.scrollbackLines", () => terminal().setScrollbackLines(5000)],
  ["terminal.cursorStyle", () => terminal().setCursorStyle("block")],
];

test.each(SETTERS)("%s moves the app-settings clock only if the bundle carries it", (leaf, write) => {
  expect(movesClock(write)).toBe(hasPath(appSettingsHandler.export(), leaf));
});

test("a held-back leaf leaves the clock alone", () => {
  useSyncPrefsStore.setState({ settingSyncOverrides: { [SHELL]: false } });
  expect(movesClock(() => terminal().setPreferredShell("/bin/fish"))).toBe(false);
});

test("a switched-off domain leaves the clock alone", () => {
  useSyncPrefsStore.setState({ syncSettingDomains: { appSettings: false } });
  expect(movesClock(() => terminal().setCursorStyle("underline"))).toBe(false);
});

test("a remote apply adopts the remote stamp, held-back leaves included", async () => {
  useSyncPrefsStore.setState({ settingSyncOverrides: { [SHELL]: false } });
  useAppSettingsTimestampStore.setState({ updatedAt: EPOCH });
  const remoteAt = "2030-01-01T00:00:00.000Z";

  await withRemoteApply(remoteAt, async () => terminal().setPreferredShell("/bin/sh"));

  expect(useAppSettingsTimestampStore.getState().updatedAt).toBe(remoteAt);
});
