// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (e: { payload: unknown }) => void>(),
  platform: "linux",
  account: "acct" as string | null,
  pending: [] as unknown[],
  gate: null as Promise<void> | null,
  failConfig: false,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, fn: (e: { payload: unknown }) => void) => {
    await h.gate;
    h.handlers.set(name, fn);
    return () => h.handlers.delete(name);
  },
}));
vi.mock("@/services/account", () => ({ getAccountId: async () => h.account }));
vi.mock("@/utils/platform", () => ({ getPlatform: async () => h.platform }));
vi.mock("@/i18n", () => ({ default: { t: (key: string, o: { name: string }) => `${key}:${o.name}` } }));

import { answerFileRequest, loadFileAccess, saveFileAccess, startDeviceFiles, stopDeviceFiles } from "./deviceFiles";
import { useDeviceFilesStore, type ApprovalPrompt } from "@/stores/deviceFilesStore";

const prompt = (requestId: string): ApprovalPrompt => ({
  requestId,
  deviceKey: "k",
  deviceName: "Laptop",
  platform: "linux",
  route: "lan",
  newDevice: true,
});
const CONFIG = { enabled: true, folders: [], readOnly: false, allowed: [], seenKeys: [] };
const calls = (cmd: string) => h.invoke.mock.calls.filter(([c]) => c === cmd);

beforeEach(async () => {
  await stopDeviceFiles();
  h.invoke.mockReset().mockImplementation(async (cmd: string) => {
    if (cmd === "device_files_get_config") {
      if (h.failConfig) throw new Error("config failed");
      return CONFIG;
    }
    if (cmd === "device_files_pending") return h.pending;
    return undefined;
  });
  h.platform = "linux";
  h.account = "acct";
  h.pending = [];
  h.handlers.clear();
  h.gate = null;
  h.failConfig = false;
});

describe("deviceFiles", () => {
  test("start_is_skipped_on_android", async () => {
    h.platform = "android";
    await startDeviceFiles();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.handlers.size).toBe(0);
  });

  test("start loads config and pending", async () => {
    h.pending = [prompt("r1")];
    await startDeviceFiles();
    expect(calls("device_files_start")[0][1]).toEqual({ accountId: "acct", notifyBody: "layout.deviceFiles.title:{name}" });
    expect(useDeviceFilesStore.getState().config).toEqual(CONFIG);
    expect(useDeviceFilesStore.getState().pending).toEqual([prompt("r1")]);
    expect([...h.handlers.keys()].sort()).toEqual(["device-files://config", "device-files://request", "device-files://sessions"]);
  });

  test("load_and_save_pass_account_without_starting_service", async () => {
    await loadFileAccess();
    expect(calls("device_files_get_config")[0][1]).toEqual({ accountId: "acct" });
    expect(useDeviceFilesStore.getState().config).toEqual(CONFIG);
    await saveFileAccess({ ...CONFIG, readOnly: true });
    expect(calls("device_files_set_config")[0][1]).toEqual({ accountId: "acct", config: { ...CONFIG, readOnly: true } });
    expect(calls("device_files_start")).toHaveLength(0);
  });

  test("load_without_account_leaves_config_empty", async () => {
    h.account = null;
    await loadFileAccess();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(useDeviceFilesStore.getState().config).toBeNull();
  });

  test("request_event_adds_pending", async () => {
    await startDeviceFiles();
    h.pending = [prompt("r2")];
    h.handlers.get("device-files://request")!({ payload: prompt("r2") });
    await vi.waitFor(() => expect(useDeviceFilesStore.getState().pending).toEqual([prompt("r2")]));
  });

  test("config event replaces the store config", async () => {
    await startDeviceFiles();
    const next = { ...CONFIG, readOnly: true };
    h.handlers.get("device-files://config")!({ payload: next });
    expect(useDeviceFilesStore.getState().config).toEqual(next);
  });

  test("answer refetches pending", async () => {
    await startDeviceFiles();
    h.pending = [];
    useDeviceFilesStore.getState().setPending([prompt("r3")]);
    await answerFileRequest("r3", "once");
    expect(calls("device_files_answer")[0][1]).toEqual({ requestId: "r3", answer: "once" });
    expect(useDeviceFilesStore.getState().pending).toEqual([]);
  });

  test("stop_clears_pending_and_sessions", async () => {
    await startDeviceFiles();
    useDeviceFilesStore.getState().setPending([prompt("r4")]);
    useDeviceFilesStore.getState().setSessions([{ deviceKey: "k", deviceName: "L", since: "t" }]);
    await stopDeviceFiles();
    const s = useDeviceFilesStore.getState();
    expect(s.pending).toEqual([]);
    expect(s.sessions).toEqual([]);
    expect(s.config).toBeNull();
    expect(h.handlers.size).toBe(0);
    expect(calls("device_files_stop")).toHaveLength(1);
  });

  test("stop during start leaves no listeners and a later start works", async () => {
    let open!: () => void;
    h.gate = new Promise<void>((r) => (open = r));
    const first = startDeviceFiles();
    await vi.waitFor(() => expect(calls("device_files_start")).toHaveLength(1));
    await stopDeviceFiles();
    open();
    await first;
    expect(h.handlers.size).toBe(0);
    h.gate = null;
    await startDeviceFiles();
    expect(calls("device_files_start")).toHaveLength(2);
    expect(h.handlers.size).toBe(3);
    expect(useDeviceFilesStore.getState().config).toEqual(CONFIG);
  });

  test("failed setup tears down and a retry succeeds", async () => {
    h.failConfig = true;
    await expect(startDeviceFiles()).rejects.toThrow("config failed");
    expect(h.handlers.size).toBe(0);
    expect(calls("device_files_stop")).toHaveLength(1);
    h.failConfig = false;
    await startDeviceFiles();
    expect(h.handlers.size).toBe(3);
  });

  test("a stale load does not overwrite a config the store already holds", async () => {
    const newer = { ...CONFIG, readOnly: true };
    useDeviceFilesStore.getState().setConfig(newer);
    await loadFileAccess();
    expect(useDeviceFilesStore.getState().config).toEqual(newer);
  });

  test("stop reaches rust only after an in-flight start", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const base = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === "device_files_start") await held;
      return base(cmd, args);
    });
    const first = startDeviceFiles();
    await vi.waitFor(() => expect(calls("device_files_start")).toHaveLength(1));
    const stopped = stopDeviceFiles();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls("device_files_stop")).toHaveLength(0);
    release();
    await Promise.all([first, stopped]);
    expect(h.invoke.mock.calls.map(([c]) => c).filter((c) => c === "device_files_start" || c === "device_files_stop")).toEqual([
      "device_files_start",
      "device_files_stop",
    ]);
    expect(h.handlers.size).toBe(0);
  });

  test("a stale start settling does not let a third start run beside the second", async () => {
    let releaseSecond!: () => void;
    const secondConfig = new Promise<void>((r) => (releaseSecond = r));
    let configs = 0;
    const base = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === "device_files_get_config" && ++configs === 2) await secondConfig;
      return base(cmd, args);
    });
    let open!: () => void;
    h.gate = new Promise<void>((r) => (open = r));
    const first = startDeviceFiles();
    await vi.waitFor(() => expect(calls("device_files_start")).toHaveLength(1));
    await stopDeviceFiles();
    const second = startDeviceFiles();
    await vi.waitFor(() => expect(calls("device_files_start")).toHaveLength(2));
    open();
    await first;
    await vi.waitFor(() => expect(calls("device_files_get_config")).toHaveLength(2));
    expect(startDeviceFiles()).toBe(second);
    releaseSecond();
    await second;
    expect(calls("device_files_start")).toHaveLength(2);
    expect(useDeviceFilesStore.getState().config).toEqual(CONFIG);
  });
});
