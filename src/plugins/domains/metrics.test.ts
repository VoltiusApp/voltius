import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { createMetricsAPI } from "./metrics";

const fakeStreams = {
  start: vi.fn(async () => "sid"),
  stop: vi.fn(async () => {}),
  on: vi.fn(async () => () => {}),
};

describe("createMetricsAPI", () => {
  beforeEach(() => {
    invoke.mockReset();
    fakeStreams.start.mockClear();
  });

  test("start delegates to the metrics stream kind", async () => {
    const api = createMetricsAPI(fakeStreams);
    await api.start("s1", true);
    expect(fakeStreams.start).toHaveBeenCalledWith("metrics", { sessionId: "s1", isRemote: true });
  });

  test("getSystemInfo calls the backing command with the real argument names", async () => {
    invoke.mockResolvedValue({ os: "linux" });
    const api = createMetricsAPI(fakeStreams);
    await expect(api.getSystemInfo("s1", "ssh", "Prod")).resolves.toEqual({ os: "linux" });
    expect(invoke).toHaveBeenCalledWith("get_connected_system_info", {
      sessionId: "s1",
      sessionType: "ssh",
      sessionName: "Prod",
    });
  });
});
