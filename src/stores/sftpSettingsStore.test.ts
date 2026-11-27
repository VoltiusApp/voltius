// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { autoRefreshIntervalSetting, useSftpSettingsStore } from "./sftpSettingsStore";
import { resetPolicy, withPolicy } from "@/test/policy";

const KEY = "appSettings.sftp.autoRefreshIntervalMs";

describe("sftp settings under policy", () => {
  beforeEach(() => {
    resetPolicy();
    useSftpSettingsStore.setState({ autoRefreshIntervalMs: 2000 });
  });

  it("setter is a no-op under a lock", () => {
    withPolicy({ [KEY]: 8000 });
    useSftpSettingsStore.getState().setAutoRefreshIntervalMs(3000);
    expect(useSftpSettingsStore.getState().autoRefreshIntervalMs).toBe(2000);
    expect(autoRefreshIntervalSetting.get()).toBe(8000);
  });

  it("a minimum lifts a lower stored interval", () => {
    withPolicy({ [KEY]: { $range: { min: 5000 } } });
    expect(autoRefreshIntervalSetting.get()).toBe(5000);
    useSftpSettingsStore.getState().setAutoRefreshIntervalMs(9000);
    expect(autoRefreshIntervalSetting.get()).toBe(9000);
  });
});

it("defaults to four simultaneous transfers and persists a bounded whole number", () => {
  const store = useSftpSettingsStore;
  expect(store.getInitialState().parallelTransfers).toBe(4);
  for (const [input, count] of [[0, 1], [3.8, 3], [100, 10], [NaN, 4]]) {
    store.getState().setParallelTransfers(input);
    expect(store.getState().parallelTransfers).toBe(count);
    expect(JSON.parse(localStorage.getItem("voltius-sftp-settings")!).state.parallelTransfers).toBe(count);
  }
});

it("clamps a stored limit above the maximum when it loads", async () => {
  localStorage.setItem("voltius-sftp-settings", JSON.stringify({ state: { parallelTransfers: 16 }, version: 1 }));
  await useSftpSettingsStore.persist.rehydrate();
  expect(useSftpSettingsStore.getState().parallelTransfers).toBe(10);
});
