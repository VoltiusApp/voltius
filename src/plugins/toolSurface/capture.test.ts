import { describe, test, it, expect, vi } from "vitest";
import { captureCommand, sendKeysToSession, buildMarkerCommand, cleanCapturedOutput, MARKER_PREFIX } from "./capture";

/**
 * Fake terminal: captures the onOutput callback so the test can feed decoded
 * output back, simulating the shell. sendCommand triggers the scripted output.
 * `script` is optional for tests that drive the callback and sendInput
 * directly instead (e.g. sendKeysToSession).
 */
function fakeApi(script: (emit: (s: string) => void, sent: string) => void = () => {}) {
  let cb: ((t: string) => void) | null = null;
  const unsub = vi.fn();
  const api = {
    sessions: {
      sendCommand: vi.fn(async (_id: string, sent: string) => {
        // emit asynchronously, after onOutput is subscribed
        queueMicrotask(() => cb && script((s) => cb!(s), sent));
      }),
      sendInput: vi.fn(async () => {}),
    },
    terminal: {
      onOutput: vi.fn(async (_id: string, fn: (t: string) => void) => {
        cb = fn;
        return unsub;
      }),
      readSnapshot: vi.fn(() => ""),
      appCursorMode: vi.fn(() => false),
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

describe("cleanCapturedOutput", () => {
  const nonce = "a1b2c3d4e5f6";
  const echoedCommand = `df -h; printf '${MARKER_PREFIX}${nonce}__:%s\\n' "$?"`;

  test("removes the echoed command line and preserves real output verbatim, including indentation", () => {
    const raw = `${echoedCommand}\nFilesystem      Size  Used Avail Use% Mounted on\n  /dev/root        97G   28G   70G  29% /\n`;
    expect(cleanCapturedOutput(raw, nonce)).toBe(
      "Filesystem      Size  Used Avail Use% Mounted on\n  /dev/root        97G   28G   70G  29% /",
    );
  });

  test("strips bracketed-paste and color CSI sequences, keeping visible text", () => {
    const raw = "\x1b[?2004lFilesystem\n\x1b[0;32mOK\x1b[0m done\n";
    expect(cleanCapturedOutput(raw, nonce)).toBe("Filesystem\nOK done");
  });

  test("strips OSC sequences (e.g. a title set)", () => {
    const raw = "\x1b]0;title\x07hello\n";
    expect(cleanCapturedOutput(raw, nonce)).toBe("hello");
  });

  test("normalizes \\r\\n to \\n", () => {
    const raw = "line1\r\nline2\r\n";
    expect(cleanCapturedOutput(raw, nonce)).toBe("line1\nline2");
  });

  test("no-echo case: buffer without the marker-format substring passes through unchanged (minus ANSI)", () => {
    const raw = "plain output\nno marker here\n";
    expect(cleanCapturedOutput(raw, nonce)).toBe("plain output\nno marker here");
  });

  test("survives the tty hard-wrapping the echoed command across several lines before the marker format", () => {
    const raw = `df -h --a --b --c\nprintf '${MARKER_PREFIX}${nonce}__:%s\\n' "$?"\nreal output line\n`;
    expect(cleanCapturedOutput(raw, nonce)).toBe("real output line");
  });

  test("survives the PTY hard-wrapping the marker FORMAT TOKEN ITSELF mid-token across a line boundary", () => {
    // Unlike the "survives the tty hard-wrapping the echoed command" case
    // above (where the wrap lands before the marker token, which stays
    // intact on one line), here the wrap lands INSIDE the marker format
    // string — echo width + the ~35-char marker suffix exceeded the
    // terminal's column width, so the token itself got split.
    const echoFormat = `${MARKER_PREFIX}${nonce}__:%s`;
    const splitAt = 20; // lands inside the nonce, well before the trailing "%s"
    const part1 = echoFormat.slice(0, splitAt);
    const part2 = echoFormat.slice(splitAt);
    const raw = `some long command line ${part1}\n${part2}\nreal output line\n`;
    expect(cleanCapturedOutput(raw, nonce)).toBe("real output line");
  });

  test("does not treat the marker result line (digit, no %s) as an echo", () => {
    const raw = `some output\n${MARKER_PREFIX}${nonce}__:0\n`;
    // the marker-result line itself is stripped elsewhere (captureCommand slices
    // it off before calling clean); here we just confirm clean doesn't mistake
    // a digit-suffixed marker line for the %s-suffixed echo format.
    expect(cleanCapturedOutput(raw, nonce)).toBe(raw.replace(/\n$/, ""));
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

  test("quiet-period floor: no marker, output goes quiet → exitCode null, timedOut false (non-POSIX degrade), incomplete true", async () => {
    vi.useFakeTimers();
    const { api, unsub } = fakeApi(() => {});
    const p = captureCommand(api, "s1", "top", { quietPeriodMs: 50, timeoutMs: 5_000 });
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    cb("interactive output...");
    await vi.advanceTimersByTimeAsync(60);
    const res = await p;
    expect(res.exitCode).toBeNull();
    expect(res.timedOut).toBe(false);
    expect(res.incomplete).toBe(true);
    expect(res.output).toBe("interactive output...");
    expect(unsub).toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("marker path sets incomplete: false", async () => {
    const { api } = fakeApi((emit) => emit("total 0\n"));
    const p = captureCommand(api, "s1", "ls", { timeoutMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();
    const nonce = (api.sessions.sendCommand.mock.calls[0][1] as string).match(/__VLT_END_(\w+)__/)![1];
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    cb(`__VLT_END_${nonce}__:0\n`);
    const res = await p;
    expect(res.incomplete).toBe(false);
  });

  test("hard timeout sets incomplete: true", async () => {
    vi.useFakeTimers();
    const { api } = fakeApi(() => {});
    const p = captureCommand(api, "s1", "top", { timeoutMs: 50 });
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    cb("interactive output...");
    await vi.advanceTimersByTimeAsync(60);
    const res = await p;
    expect(res.timedOut).toBe(true);
    expect(res.incomplete).toBe(true);
    vi.useRealTimers();
  });

  test("a gap shorter than the quiet period does not truncate: output continues past the gap and the marker still resolves it cleanly", async () => {
    vi.useFakeTimers();
    const { api } = fakeApi(() => {});
    const p = captureCommand(api, "s1", "sh -c 'echo start; sleep 1; echo end'", { quietPeriodMs: 2_000, timeoutMs: 10_000 });
    await Promise.resolve();
    await Promise.resolve();
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    const nonce = (api.sessions.sendCommand.mock.calls[0][1] as string).match(/__VLT_END_(\w+)__/)![1];

    cb("start\n");
    await vi.advanceTimersByTimeAsync(1_000); // gap shorter than quietPeriodMs
    cb("end\n");
    cb(`__VLT_END_${nonce}__:0\n`);

    const res = await p;
    expect(res.output).toBe("start\nend");
    expect(res.exitCode).toBe(0);
    expect(res.incomplete).toBe(false);
    expect(res.timedOut).toBe(false);
    vi.useRealTimers();
  });

  test("default quietPeriodMs is 10_000: a command that pauses 9s mid-output is NOT truncated by the floor", async () => {
    vi.useFakeTimers();
    const { api } = fakeApi(() => {});
    const p = captureCommand(api, "s1", "echo start; sleep 9; echo end", { timeoutMs: 30_000 });
    await Promise.resolve();
    await Promise.resolve();
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    const nonce = (api.sessions.sendCommand.mock.calls[0][1] as string).match(/__VLT_END_(\w+)__/)![1];

    cb("start\n");
    await vi.advanceTimersByTimeAsync(9_000); // less than the 10s default floor
    cb("end\n");
    cb(`__VLT_END_${nonce}__:0\n`);

    const res = await p;
    expect(res.output).toBe("start\nend");
    expect(res.exitCode).toBe(0);
    expect(res.incomplete).toBe(false);
    vi.useRealTimers();
  });

  test("end-to-end: strips echoed command + ANSI noise from a realistic live capture", async () => {
    const { api } = fakeApi((emit, sent) => {
      // simulate the tty echoing back what was "typed", plus bracketed-paste
      // off, plus the real command output, before the marker line.
      emit(`${sent}\n`);
      emit("\x1b[?2004lFilesystem      Size  Used Avail Use% Mounted on\n");
      emit("/dev/root        97G   28G   70G  29% /\n");
    });
    const p = captureCommand(api, "s1", "df -h", { timeoutMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();
    const nonce = (api.sessions.sendCommand.mock.calls[0][1] as string).match(/__VLT_END_(\w+)__/)![1];
    const cb = api.terminal.onOutput.mock.calls[0][1] as (t: string) => void;
    cb(`__VLT_END_${nonce}__:0\n`);
    const res = await p;
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe("Filesystem      Size  Used Avail Use% Mounted on\n/dev/root        97G   28G   70G  29% /");
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

describe("sendKeysToSession", () => {
  it("subscribes to output BEFORE writing, so a fast redraw is not missed", async () => {
    const order: string[] = [];
    const { api } = fakeApi();
    api.terminal.onOutput = vi.fn(async () => { order.push("subscribe"); return () => {}; });
    api.sessions.sendInput = vi.fn(async () => { order.push("write"); });
    await sendKeysToSession(api, "s1", "\x1b[B", { quietMs: 5, firstOutputMs: 10, timeoutMs: 50 });
    expect(order).toEqual(["subscribe", "write"]);
  });

  it("resolves settled once output goes quiet, returning the screen", async () => {
    const { api } = fakeApi();
    let emit: (t: string) => void = () => {};
    api.terminal.onOutput = vi.fn(async (_id: string, cb: (t: string) => void) => { emit = cb; return () => {}; });
    api.terminal.readSnapshot = vi.fn(() => "  1  top - load average");
    const p = sendKeysToSession(api, "s1", "top\r", { quietMs: 20, timeoutMs: 500 });
    setTimeout(() => emit("redraw"), 5);
    const r = await p;
    expect(r).toMatchObject({ settled: true, outputSeen: true, timedOut: false, screen: "  1  top - load average" });
  });

  // Regression guard: the quiet timer must arm on the FIRST byte, never before
  // the write. Armed up front, this call would settle at 300ms on the stale
  // pre-keystroke screen and report settled: true.
  it("does not arm the quiet timer before output arrives: late output still wins", async () => {
    const { api } = fakeApi();
    let emit: (t: string) => void = () => {};
    api.terminal.onOutput = vi.fn(async (_id: string, cb: (t: string) => void) => { emit = cb; return () => {}; });
    let screen = "root@host:~# ";
    api.terminal.readSnapshot = vi.fn(() => screen);
    // quietMs left at its 300ms default; the first byte lands well after it.
    const p = sendKeysToSession(api, "s1", "top\r", { firstOutputMs: 2000, timeoutMs: 5000 });
    setTimeout(() => { screen = "top - 12:00:00 up 1 day"; emit("redraw"); }, 400);
    const r = await p;
    expect(r).toMatchObject({ settled: true, outputSeen: true, timedOut: false });
    expect(r.screen).toBe("top - 12:00:00 up 1 day");
  });

  it("resolves timedOut when output never goes quiet", async () => {
    const { api } = fakeApi();
    let emit: (t: string) => void = () => {};
    api.terminal.onOutput = vi.fn(async (_id: string, cb: (t: string) => void) => { emit = cb; return () => {}; });
    const noise = setInterval(() => emit("."), 5);
    const r = await sendKeysToSession(api, "s1", "x", { quietMs: 50, firstOutputMs: 1000, timeoutMs: 120 });
    clearInterval(noise);
    expect(r).toMatchObject({ settled: false, outputSeen: true, timedOut: true });
  });

  it("resolves at firstOutputMs, not the deadline, when the keys produce nothing", async () => {
    const { api } = fakeApi();
    api.terminal.readSnapshot = vi.fn(() => "$ ");
    const started = Date.now();
    const r = await sendKeysToSession(api, "s1", "\x03", { quietMs: 10, firstOutputMs: 40, timeoutMs: 5000 });
    expect(r).toMatchObject({ settled: true, outputSeen: false, timedOut: false, screen: "$ " });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("keeps its defaults when a caller forwards explicit undefined options", async () => {
    const { api } = fakeApi();
    let emit: (t: string) => void = () => {};
    api.terminal.onOutput = vi.fn(async (_id: string, cb: (t: string) => void) => { emit = cb; return () => {}; });
    let screen = "before";
    api.terminal.readSnapshot = vi.fn(() => screen);
    const p = sendKeysToSession(api, "s1", "x", { quietMs: undefined, timeoutMs: undefined, firstOutputMs: 800 });
    setTimeout(() => { screen = "after"; emit("redraw"); }, 30);
    const r = await p;
    expect(r).toMatchObject({ settled: true, outputSeen: true, timedOut: false, screen: "after" });
  });

  it("unsubscribes exactly once", async () => {
    const { api } = fakeApi();
    const unsub = vi.fn();
    api.terminal.onOutput = vi.fn(async () => unsub);
    await sendKeysToSession(api, "s1", "x", { quietMs: 5, firstOutputMs: 10, timeoutMs: 50 });
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed write instead of reporting a settled screen", async () => {
    const { api } = fakeApi();
    api.sessions.sendInput = vi.fn(async () => { throw new Error("channel closed"); });
    await expect(sendKeysToSession(api, "s1", "x", { quietMs: 5, firstOutputMs: 10, timeoutMs: 50 })).rejects.toThrow("channel closed");
  });
});
