import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  status: "idle",
  downloadUpdate: vi.fn(async () => {}),
  setAutoUpdate: vi.fn(async () => {}),
}));

vi.mock("@/services/updater", () => ({
  getAutoUpdate: vi.fn(async () => true),
  setAutoUpdate: h.setAutoUpdate,
  downloadUpdate: h.downloadUpdate,
  getUpdaterState: () => ({ status: h.status, version: "9.9.9" }),
}));

beforeEach(() => {
  vi.resetModules();
  h.downloadUpdate.mockClear();
  h.setAutoUpdate.mockClear();
});

test("turning auto-download on starts downloading an update that is waiting", async () => {
  h.status = "available";
  const { useUpdaterPrefStore } = await import("./updaterPrefStore");

  useUpdaterPrefStore.getState().setAutoUpdate(true);

  expect(h.setAutoUpdate).toHaveBeenCalledWith(true);
  expect(h.downloadUpdate).toHaveBeenCalledOnce();
});

test("turning auto-download on with nothing waiting downloads nothing", async () => {
  h.status = "upToDate";
  const { useUpdaterPrefStore } = await import("./updaterPrefStore");

  useUpdaterPrefStore.getState().setAutoUpdate(true);

  expect(h.downloadUpdate).not.toHaveBeenCalled();
});

test("turning auto-download off never downloads", async () => {
  h.status = "available";
  const { useUpdaterPrefStore } = await import("./updaterPrefStore");

  useUpdaterPrefStore.getState().setAutoUpdate(false);

  expect(h.setAutoUpdate).toHaveBeenCalledWith(false);
  expect(h.downloadUpdate).not.toHaveBeenCalled();
});
