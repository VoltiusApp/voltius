import { describe, it, expect, vi, beforeEach } from "vitest";

const pluginLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock("@tauri-apps/plugin-log", () => ({
  info: (...a: unknown[]) => pluginLog.info(...a),
  warn: (...a: unknown[]) => pluginLog.warn(...a),
  error: (...a: unknown[]) => pluginLog.error(...a),
  debug: (...a: unknown[]) => pluginLog.debug(...a),
}));

const addToast = vi.fn();
const openSettings = vi.fn();
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast }) },
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ openSettings }) },
}));

import { log, installGlobalErrorLogging, setLoggerVerbose } from "./logger";

beforeEach(() => {
  pluginLog.info.mockClear();
  pluginLog.warn.mockClear();
  pluginLog.error.mockClear();
  pluginLog.debug.mockClear();
  addToast.mockClear();
  openSettings.mockClear();
  setLoggerVerbose(false);
});

describe("log", () => {
  it("forwards to the plugin with an [fe] prefix", () => {
    log.info("hello", { a: 1 });
    expect(pluginLog.info).toHaveBeenCalledTimes(1);
    expect(pluginLog.info.mock.calls[0][0]).toContain("[fe]");
    expect(pluginLog.info.mock.calls[0][0]).toContain("hello");
  });

  it("does not forward log.debug to the plugin when verbose is off", () => {
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    log.debug("quiet");
    expect(pluginLog.debug).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("forwards log.debug to the plugin once verbose is enabled", () => {
    setLoggerVerbose(true);
    log.debug("loud");
    expect(pluginLog.debug).toHaveBeenCalledTimes(1);
    expect(pluginLog.debug.mock.calls[0][0]).toContain("[fe]");
  });
});

describe("installGlobalErrorLogging", () => {
  it("routes unhandled errors into log.error", () => {
    installGlobalErrorLogging();
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(pluginLog.error).toHaveBeenCalled();
    expect(pluginLog.error.mock.calls[0][0]).toContain("boom");
  });

  it("raises a toast with a create-report action on uncaught errors", () => {
    installGlobalErrorLogging();
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(addToast).toHaveBeenCalled();
    const toast = addToast.mock.calls[0][0];
    expect(toast.action).toBeDefined();
    toast.action.onClick();
    expect(openSettings).toHaveBeenCalledWith("diagnostics");
  });
});
