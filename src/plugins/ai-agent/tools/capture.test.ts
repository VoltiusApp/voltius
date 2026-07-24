import { describe, test, expect, vi } from "vitest";
import { captureCommand, buildMarkerCommand } from "./capture";

/**
 * Fake terminal: captures the onOutput callback so the test can feed decoded
 * output back, simulating the shell. sendCommand triggers the scripted output.
 */
function fakeApi(script: (emit: (s: string) => void, sent: string) => void) {
  let cb: ((t: string) => void) | null = null;
  const unsub = vi.fn();
  const api = {
    sessions: {
      sendCommand: vi.fn(async (_id: string, sent: string) => {
        // emit asynchronously, after onOutput is subscribed
        queueMicrotask(() => cb && script((s) => cb!(s), sent));
      }),
    },
    terminal: {
      onOutput: vi.fn(async (_id: string, fn: (t: string) => void) => {
        cb = fn;
        return unsub;
      }),
    },
  } as any;
  return { api, unsub };
}

describe("buildMarkerCommand", () => {
  test("wraps with printf $? and a nonce", () => {
    const c = buildMarkerCommand("ls -la", "N1");
    expect(c).toBe("ls -la; printf '__VLT_END_N1__:%s\\n' \"$?\"");
  });
});

describe("captureCommand", () => {
  test("parses exit code, strips the marker line from output", async () => {
    // The script can't know the real nonce ahead of time, so it only emits
    // plain output here; the marker (with the real nonce) is fed manually
    // below via the captured onOutput callback, split across two chunks to
    // exercise cross-chunk marker buffering.
    const { api, unsub } = fakeApi((emit) => {
      emit("total 0\nfile.txt\n");
    });
    const p = captureCommand(api, "s1", "ls", { timeoutMs: 1000 });
    // drive: grab the onOutput cb and feed the marker with the nonce used
    // sendCommand fires inside a .then() chained off onOutput's promise, so
    // flush a microtask tick before reading the mock call.
    await Promise.resolve();
    await Promise.resolve();
    const nonce = (api.sessions.sendCommand.mock.calls[0][1] as string).match(/__VLT_END_(\w+)__/)![1];
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    const marker = `__VLT_END_${nonce}__:0\n`;
    cb(marker.slice(0, 5)); // marker split across two chunks
    cb(marker.slice(5));
    const res = await p;
    expect(res.output).toBe("total 0\nfile.txt");
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
    expect(unsub).toHaveBeenCalled();
  });

  test("non-zero exit code is captured", async () => {
    const { api } = fakeApi(() => {});
    const p = captureCommand(api, "s1", "false", { timeoutMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();
    const nonce = (api.sessions.sendCommand.mock.calls[0][1] as string).match(/__VLT_END_(\w+)__/)![1];
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    cb(`bash: boom\n__VLT_END_${nonce}__:1\n`);
    const res = await p;
    expect(res.output).toBe("bash: boom");
    expect(res.exitCode).toBe(1);
  });

  test("timeout with no marker → exitCode null, timedOut true, keeps accumulated output", async () => {
    vi.useFakeTimers();
    const { api, unsub } = fakeApi(() => {});
    const p = captureCommand(api, "s1", "top", { timeoutMs: 50 });
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    cb("interactive output...");
    await vi.advanceTimersByTimeAsync(60);
    const res = await p;
    expect(res.exitCode).toBeNull();
    expect(res.timedOut).toBe(true);
    expect(res.output).toContain("interactive output");
    expect(unsub).toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("output over maxChars is truncated + flagged", async () => {
    const { api } = fakeApi(() => {});
    const p = captureCommand(api, "s1", "cat big", { timeoutMs: 1000, maxChars: 10 });
    await Promise.resolve();
    await Promise.resolve();
    const nonce = (api.sessions.sendCommand.mock.calls[0][1] as string).match(/__VLT_END_(\w+)__/)![1];
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    cb("0123456789ABCDEF\n");
    cb(`__VLT_END_${nonce}__:0\n`);
    const res = await p;
    expect(res.truncated).toBe(true);
    expect(res.output.length).toBeLessThanOrEqual(10);
  });
});
