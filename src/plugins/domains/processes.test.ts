import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { createProcessesAPI } from "./processes";

const fakeStreams = {
  start: vi.fn(async () => "sid"),
  stop: vi.fn(async () => {}),
  on: vi.fn(async () => () => {}),
};

describe("createProcessesAPI", () => {
  beforeEach(() => {
    invoke.mockReset();
    fakeStreams.start.mockClear();
  });

  test("start delegates to the processes stream kind", async () => {
    const api = createProcessesAPI(fakeStreams);
    await api.start("s1", false);
    expect(fakeStreams.start).toHaveBeenCalledWith("processes", {
      sessionId: "s1",
      isRemote: false,
    });
  });

  test("kill forwards pid and force to the backing command", async () => {
    invoke.mockResolvedValue(undefined);
    const api = createProcessesAPI(fakeStreams);
    await api.kill("s1", 4242, true, true);
    expect(invoke).toHaveBeenCalledWith("process_kill", {
      sessionId: "s1",
      pid: 4242,
      isRemote: true,
      force: true,
    });
  });

  test("kill does not swallow a backend failure", async () => {
    invoke.mockRejectedValue(new Error("EPERM"));
    const api = createProcessesAPI(fakeStreams);
    await expect(api.kill("s1", 1, true, false)).rejects.toThrow("EPERM");
  });
});
