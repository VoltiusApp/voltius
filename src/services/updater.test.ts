import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  handler: null as null | ((e: { payload: unknown }) => void),
  listenOrder: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, ...rest: unknown[]) => {
    h.listenOrder.push(cmd);
    return h.invoke(cmd, ...rest);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, fn: (e: { payload: unknown }) => void) => {
    h.listenOrder.push("listen");
    h.handler = fn;
    return () => {};
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  h.invoke.mockReset();
  h.handler = null;
  h.listenOrder = [];
});

test("seeds the state the backend already reached before the listener attached", async () => {
  h.invoke.mockResolvedValue({ status: "ready", version: "9.9.9" });
  const { initUpdaterListener, getUpdaterState } = await import("./updater");

  initUpdaterListener();

  await vi.waitFor(() => expect(getUpdaterState()).toEqual({ status: "ready", version: "9.9.9" }));
  expect(h.listenOrder).toEqual(["listen", "updater_get_state"]);
});

test("events after seeding keep driving the state", async () => {
  h.invoke.mockResolvedValue({ status: "idle" });
  const { initUpdaterListener, getUpdaterState } = await import("./updater");

  initUpdaterListener();
  await vi.waitFor(() => expect(h.listenOrder).toContain("updater_get_state"));
  h.handler!({ payload: { status: "available", version: "9.9.9" } });

  expect(getUpdaterState()).toEqual({ status: "available", version: "9.9.9" });
});

test("an event that lands before the seed reply is not overwritten by it", async () => {
  let reply!: (v: unknown) => void;
  h.invoke.mockReturnValue(new Promise((r) => { reply = r; }));
  const { initUpdaterListener, getUpdaterState } = await import("./updater");

  initUpdaterListener();
  await vi.waitFor(() => expect(h.listenOrder).toContain("updater_get_state"));
  h.handler!({ payload: { status: "ready", version: "9.9.9" } });
  reply({ status: "downloading", version: "9.9.9", progress: 99 });
  await Promise.resolve();
  await Promise.resolve();

  expect(getUpdaterState()).toEqual({ status: "ready", version: "9.9.9" });
});

test("downloadUpdate asks the backend to download", async () => {
  h.invoke.mockResolvedValue(undefined);
  const { downloadUpdate } = await import("./updater");

  await downloadUpdate();

  expect(h.invoke).toHaveBeenCalledWith("updater_check", { download: true });
});
