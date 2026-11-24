import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TmuxHostStatus } from "@/services/tmuxInstall";

const h = vi.hoisted(() => ({
  status: undefined as unknown,
  pin: "3.5a",
  autoUpdate: true,
  install: (() => Promise.resolve()) as () => Promise<unknown>,
  sessions: [] as Array<Record<string, unknown>>,
  tmuxStatus: vi.fn(async (_s: string): Promise<unknown> => undefined),
  tmuxInstall: vi.fn((_s: string, _p: (x: { step: string; progress: number }) => void) => ({ promise: Promise.resolve() as Promise<unknown>, cancel: () => {} })),
  tmuxPrune: vi.fn(async (_s: string): Promise<unknown> => undefined),
  connect: vi.fn(async (_id: string) => "s2"),
}));
const { tmuxStatus, tmuxInstall, tmuxPrune, connect } = h;

vi.mock("@/services/tmuxInstall", async (actual) => ({
  ...(await actual<typeof import("@/services/tmuxInstall")>()),
  tmuxStatus: h.tmuxStatus,
  tmuxInstall: h.tmuxInstall,
  tmuxPrune: h.tmuxPrune,
  tmuxPinVersion: async () => h.pin,
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ getToggle: (id: string) => (id === "tmux-auto-update" ? h.autoUpdate : true) }));
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: { getState: () => ({ sessions: h.sessions, connect: h.connect }) } }));
vi.mock("@/i18n", () => ({ default: { t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) } }));
vi.mock("@/services/backendErrors", () => ({ describeError: (e: unknown) => String(e) }));
vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(), debug: vi.fn() }, logFailure: () => () => {} }));

import { startTmuxInstall, tmuxOlder, tmuxOnConnect } from "./tmuxOnConnect";
import { useHostMuxStore } from "@/stores/hostMuxStore";
import { useNotificationStore } from "@/stores/notificationStore";

const SCREEN = { control: false, tmux: "", fallback: "screen" };
const CC = { control: true, tmux: "3.4", fallback: null };
const NONE_YET: TmuxHostStatus = { supported: true, system: null, active: null, copies: [] };
const STATUS_35: TmuxHostStatus = { supported: true, system: null, active: "3.5a", copies: [{ version: "3.5a", sessions: 0 }] };

const toasts = () => useNotificationStore.getState().toasts;
const flush = () => new Promise((r) => setTimeout(r, 0));

async function connectWith(mode: typeof SCREEN | typeof CC, session = "s1") {
  tmuxOnConnect(session, "c1", "web-01", mode);
  await flush();
}

beforeEach(() => {
  tmuxStatus.mockReset().mockImplementation(async () => h.status);
  tmuxInstall.mockReset().mockImplementation(() => ({ promise: h.install(), cancel: () => {} }));
  tmuxPrune.mockReset().mockImplementation(async () => h.status);
  connect.mockClear();
  Object.assign(h, { status: NONE_YET, pin: "3.5a", autoUpdate: true, install: () => Promise.resolve(STATUS_35) });
  h.sessions = [{ id: "s1", connectionId: "c1", connectionName: "web-01", type: "ssh", status: "connected" }];
  useHostMuxStore.setState({ hosts: {} });
  useNotificationStore.setState({ toasts: [], history: [] });
});

describe("tmuxOlder", () => {
  test("orders tmux versions, letters after numbers", () => {
    expect(tmuxOlder("3.4", "3.5a")).toBe(true);
    expect(tmuxOlder("3.5", "3.5a")).toBe(true);
    expect(tmuxOlder("3.5a", "3.5a")).toBe(false);
    expect(tmuxOlder("3.6", "3.5a")).toBe(false);
    expect(tmuxOlder("3.9", "3.10")).toBe(true);
    expect(tmuxOlder("3.10", "3.9")).toBe(false);
    expect(tmuxOlder("next-3.6", "3.5a")).toBe(false);
  });
});

describe("tmuxOnConnect", () => {
  test("records the host before anything else", async () => {
    await connectWith(SCREEN);
    expect(useHostMuxStore.getState().hosts.c1?.kind).toBe("screen");
  });

  test("an unknown fallback does nothing", async () => {
    tmuxOnConnect("s1", "c1", "web-01", { control: false, tmux: "", fallback: "" });
    await flush();
    expect(useHostMuxStore.getState().hosts.c1).toBeUndefined();
    expect(tmuxStatus).not.toHaveBeenCalled();
  });

  test("the first screen report offers Install once, with the host badge", async () => {
    await connectWith(SCREEN);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toContain("notifications.tmux.screen");
    expect(toasts()[0].action?.label).toBe("notifications.tmux.install");
    expect(toasts()[0].host).toEqual({ connectionId: "c1", name: "web-01" });
    await connectWith(SCREEN);
    expect(toasts()).toHaveLength(1);
  });

  test("old tmux and no multiplexer get their own notice", async () => {
    tmuxOnConnect("s1", "c1", "web-01", { control: false, tmux: "", fallback: "tmux 3.0a" });
    await flush();
    tmuxOnConnect("s1", "c2", "db-01", { control: false, tmux: "", fallback: "none" });
    await flush();
    expect(toasts().map((t) => t.message.split(" ")[0])).toEqual(["notifications.tmux.old", "notifications.tmux.none"]);
    expect(toasts()[0].message).toContain('"version":"3.0a"');
  });

  test("tmux control mode gets no notice", async () => {
    await connectWith(CC);
    expect(toasts()).toEqual([]);
  });

  test("no notice when the host already has a Voltius copy (an old screen session re-attached)", async () => {
    h.status = STATUS_35;
    await connectWith(SCREEN);
    expect(toasts()).toEqual([]);
  });

  test("an unsupported host gets no Install offer and is recorded as unsupported", async () => {
    h.status = { ...NONE_YET, supported: false };
    await connectWith(SCREEN);
    expect(toasts()).toEqual([]);
    expect(useHostMuxStore.getState().hosts.c1?.kind).toBe("unsupported");
  });

  test("remembers the Voltius copy the host reports", async () => {
    h.status = { supported: true, system: "3.0a", active: "3.5a", copies: [{ version: "3.4", sessions: 2 }, { version: "3.5a", sessions: 1 }] };
    await connectWith(CC);
    expect(useHostMuxStore.getState().hosts.c1?.voltius).toEqual({ active: "3.5a", versions: ["3.4", "3.5a"], inUse: { "3.4": 2, "3.5a": 1 } });
  });

  test("an older Voltius copy is updated quietly when the setting is on", async () => {
    h.status = { supported: true, system: null, active: "3.4", copies: [{ version: "3.4", sessions: 1 }] };
    await connectWith(CC);
    expect(tmuxInstall).toHaveBeenCalledTimes(1);
    expect(toasts().some((t) => t.action?.label === "notifications.tmux.install")).toBe(false);
    expect(toasts().map((t) => t.message)).toEqual([`notifications.tmux.updated ${JSON.stringify({ version: "3.5a", host: "web-01" })}`]);
  });

  test("no update with the setting off", async () => {
    h.autoUpdate = false;
    h.status = { supported: true, system: null, active: "3.4", copies: [{ version: "3.4", sessions: 1 }] };
    await connectWith(CC);
    expect(tmuxInstall).not.toHaveBeenCalled();
  });

  test("never installs over a newer Voltius copy", async () => {
    h.status = { supported: true, system: null, active: "3.6", copies: [{ version: "3.6", sessions: 1 }] };
    await connectWith(CC);
    expect(tmuxInstall).not.toHaveBeenCalled();
  });

  test("prunes a copy that no session uses any more", async () => {
    h.status = { supported: true, system: null, active: "3.5a", copies: [{ version: "3.4", sessions: 0 }, { version: "3.5a", sessions: 1 }] };
    await connectWith(CC);
    expect(tmuxPrune).toHaveBeenCalledWith("s1");
  });

  test("keeps a copy that still serves sessions", async () => {
    h.status = { supported: true, system: null, active: "3.5a", copies: [{ version: "3.4", sessions: 2 }, { version: "3.5a", sessions: 1 }] };
    await connectWith(CC);
    expect(tmuxPrune).not.toHaveBeenCalled();
  });

  test("tabs opening together check the host once", async () => {
    tmuxOnConnect("s1", "c1", "web-01", CC);
    tmuxOnConnect("s2", "c1", "web-01", CC);
    await flush();
    expect(tmuxStatus).toHaveBeenCalledTimes(1);
  });
});

describe("startTmuxInstall", () => {
  test("the Install action runs the install, then offers a new tab on the same host", async () => {
    await connectWith(SCREEN);
    toasts()[0].action!.onClick();
    await flush();
    expect(tmuxInstall).toHaveBeenCalledWith("s1", expect.any(Function));
    const done = toasts().find((t) => t.finished);
    expect(done?.finishedSeverity).toBe("success");
    expect(done?.message).toContain("notifications.tmux.installed");
    expect(done?.action?.label).toBe("notifications.tmux.openNewTab");
    done!.action!.onClick();
    expect(connect).toHaveBeenCalledWith("c1");
    expect(useHostMuxStore.getState().hosts.c1?.voltius?.active).toBe("3.5a");
  });

  test("shows progress with the step while it runs", async () => {
    let finish: (s: TmuxHostStatus) => void = () => {};
    const pending = new Promise<TmuxHostStatus>((r) => (finish = r));
    h.install = () => pending;
    startTmuxInstall("s1", "c1", "web-01");
    await flush();
    const onProgress = tmuxInstall.mock.calls[0][1];
    onProgress({ step: "verify", progress: 85 });
    const running = toasts()[0];
    expect(running.type).toBe("progress");
    expect(running.cancellable).toBe(true);
    expect(running.progress).toBe(85);
    expect(running.message).toContain("notifications.tmux.step.verify");
    finish(STATUS_35);
    await flush();
  });

  test("a second click while installing starts nothing", async () => {
    let finish: (s: TmuxHostStatus) => void = () => {};
    const pending = new Promise<TmuxHostStatus>((r) => (finish = r));
    h.install = () => pending;
    startTmuxInstall("s1", "c1", "web-01");
    startTmuxInstall("s1", "c1", "web-01");
    await flush();
    expect(tmuxInstall).toHaveBeenCalledTimes(1);
    finish(STATUS_35);
    await flush();
  });

  test("a failure names its cause", async () => {
    h.install = () => Promise.reject("checksum");
    startTmuxInstall("s1", "c1", "web-01");
    await flush();
    expect(toasts()[0].finishedSeverity).toBe("error");
    expect(toasts()[0].message).toContain("notifications.tmux.failed.checksum");
  });

  test("a cancelled install leaves no toast", async () => {
    h.install = () => Promise.reject("cancelled");
    startTmuxInstall("s1", "c1", "web-01");
    await flush();
    expect(toasts()).toEqual([]);
  });
});
