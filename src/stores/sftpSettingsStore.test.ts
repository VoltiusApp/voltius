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
