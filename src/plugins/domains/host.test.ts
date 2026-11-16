import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listen(...a) }));

import { createHostAPI } from "./host";

const DONE = { stdout: "", stderr: "", code: 0, timedOut: false, truncated: false, cancelled: false };
const remote = () => ({ isRemote: true, localShell: null });

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
});

describe("createHostAPI", () => {
  test("exec sends one request with the session's target and the caller's limits", async () => {
    invoke.mockResolvedValue({ ...DONE, stdout: "hi\n" });
    const api = createHostAPI(() => ({ isRemote: false, localShell: "/bin/zsh" }));
    const r = await api.exec("s1", "echo hi", { timeoutMs: 5, maxBytes: 9, stdin: "x" });
    expect(r.stdout).toBe("hi\n");
    expect(invoke).toHaveBeenCalledWith("host_exec", {
      request: expect.objectContaining({
        sessionId: "s1", command: "echo hi", stream: false, isRemote: false,
        localShell: "/bin/zsh", timeoutMs: 5, maxBytes: 9, stdin: "x",
      }),
    });
  });

  test("a session that cannot run commands rejects before anything is sent", async () => {
    const api = createHostAPI(() => { throw new Error("serial"); });
    await expect(api.exec("s1", "ls")).rejects.toThrow("serial");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("stream listens before it starts the command, then routes chunks and unlistens", async () => {
    const order: string[] = [];
    let emit: (e: { payload: { stream: string; data: string } }) => void = () => {};
    const unlisten = vi.fn();
    listen.mockImplementation(async (_event: string, h: typeof emit) => {
      order.push("listen");
      emit = h;
      return unlisten;
    });
    invoke.mockImplementation(async () => {
      order.push("invoke");
      emit({ payload: { stream: "stdout", data: "a\n" } });
      emit({ payload: { stream: "stderr", data: "e\n" } });
      return DONE;
    });
    const out: string[] = [];
    const err: string[] = [];
    const handle = createHostAPI(remote).stream("s1", "du", { onStdout: (c) => out.push(c), onStderr: (c) => err.push(c) });
    await handle.done;
    expect(order).toEqual(["listen", "invoke"]);
    const [event] = listen.mock.calls[0];
    expect(event).toBe(`host-exec:${invoke.mock.calls[0][1].request.execId}`);
    expect(out).toEqual(["a\n"]);
    expect(err).toEqual(["e\n"]);
    expect(unlisten).toHaveBeenCalled();
  });

  test("a cancel before the command starts runs nothing, and one after it ends sends nothing", async () => {
    listen.mockResolvedValue(vi.fn());
    invoke.mockResolvedValue(DONE);
    const api = createHostAPI(remote);
    const early = api.stream("s1", "du", {});
    early.cancel();
    expect((await early.done).cancelled).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    const late = api.stream("s1", "du", {});
    await late.done;
    invoke.mockClear();
    late.cancel();
    expect(invoke).not.toHaveBeenCalled();
  });

  test("cancel and dispose stop running commands by id", async () => {
    listen.mockResolvedValue(vi.fn());
    let finish: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === "host_exec" ? new Promise((r) => { finish = r; }) : Promise.resolve(),
    );
    const api = createHostAPI(remote);
    const handle = api.stream("s1", "sleep 9", {});
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("host_exec", expect.anything()));
    const execId = invoke.mock.calls[0][1].request.execId;
    handle.cancel();
    expect(invoke).toHaveBeenCalledWith("host_exec_cancel", { execId });
    invoke.mockClear();
    api.dispose();
    expect(invoke).toHaveBeenCalledWith("host_exec_cancel", { execId });
    finish(DONE);
    await handle.done;
  });
});
