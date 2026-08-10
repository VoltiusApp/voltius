import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { DockerLogLine } from "./types";

const h = vi.hoisted(() => ({
  stopped: [] as string[],
  listeners: new Map<string, (l: DockerLogLine) => void>(),
  unlistened: [] as string[],
}));

vi.mock("./services", () => ({
  dockerStopLogStream: vi.fn(async (sid: string) => { h.stopped.push(sid); }),
  onDockerLog: vi.fn(async (sid: string, cb: (l: DockerLogLine) => void) => {
    h.listeners.set(sid, cb);
    return () => { h.unlistened.push(sid); h.listeners.delete(sid); };
  }),
}));

import { stripAnsi, useLogStream } from "./useLogStream";

function line(text: string, stream: "stdout" | "stderr" = "stdout"): DockerLogLine {
  return { line: text, stream } as DockerLogLine;
}

function Probe({ streamKey, start, enabled, seen }: {
  streamKey: string;
  start: () => Promise<string>;
  enabled?: boolean;
  seen: DockerLogLine[][];
}) {
  const { lines } = useLogStream(streamKey, start, enabled);
  seen.push(lines);
  return null;
}

/** Lets the hook's async start() chain settle. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  h.stopped.length = 0;
  h.unlistened.length = 0;
  h.listeners.clear();
});
afterEach(cleanup);

describe("stripAnsi", () => {
  test("drops SGR escapes and keeps the text", () => {
    expect(stripAnsi("\x1b[31merror\x1b[0m: boom")).toBe("error: boom");
  });
});

describe("useLogStream", () => {
  test("subscribes to the started stream and tails its lines", async () => {
    const seen: DockerLogLine[][] = [];
    render(<Probe streamKey="a" start={async () => "sid-1"} seen={seen} />);
    await settle();

    act(() => { h.listeners.get("sid-1")!(line("hello")); });
    expect(seen[seen.length - 1].map((l) => l.line)).toEqual(["hello"]);
  });

  test("caps the buffer at 2000 lines, keeping the newest", async () => {
    const seen: DockerLogLine[][] = [];
    render(<Probe streamKey="a" start={async () => "sid-1"} seen={seen} />);
    await settle();

    act(() => {
      for (let i = 0; i < 2100; i++) h.listeners.get("sid-1")!(line(`l${i}`));
    });
    const last = seen[seen.length - 1];
    expect(last).toHaveLength(2000);
    expect(last[0].line).toBe("l100");
    expect(last[1999].line).toBe("l2099");
  });

  test("stops the backend stream on unmount", async () => {
    const seen: DockerLogLine[][] = [];
    const view = render(<Probe streamKey="a" start={async () => "sid-1"} seen={seen} />);
    await settle();

    await act(async () => { view.unmount(); await Promise.resolve(); });
    expect(h.stopped).toContain("sid-1");
    expect(h.unlistened).toContain("sid-1");
  });

  test("a key change stops the old stream, clears the lines and starts the new one", async () => {
    const seen: DockerLogLine[][] = [];
    const start = vi.fn(async () => (start.mock.calls.length === 1 ? "sid-1" : "sid-2"));
    const view = render(<Probe streamKey="a" start={start} seen={seen} />);
    await settle();
    act(() => { h.listeners.get("sid-1")!(line("old")); });

    view.rerender(<Probe streamKey="b" start={start} seen={seen} />);
    await settle();

    expect(h.stopped).toContain("sid-1");
    expect(h.listeners.has("sid-2")).toBe(true);
    expect(seen[seen.length - 1]).toEqual([]);
  });

  test("re-rendering with the same key does not restart the stream", async () => {
    const seen: DockerLogLine[][] = [];
    const start = vi.fn(async () => "sid-1");
    // A fresh start callback each render must not, on its own, restart the stream.
    const view = render(<Probe streamKey="a" start={() => start()} seen={seen} />);
    await settle();
    view.rerender(<Probe streamKey="a" start={() => start()} seen={seen} />);
    await settle();

    expect(start).toHaveBeenCalledTimes(1);
    expect(h.stopped).toEqual([]);
  });

  test("disabled never starts a stream", async () => {
    const seen: DockerLogLine[][] = [];
    const start = vi.fn(async () => "sid-1");
    const view = render(<Probe streamKey="a" start={start} enabled={false} seen={seen} />);
    await settle();
    expect(start).not.toHaveBeenCalled();

    view.rerender(<Probe streamKey="a" start={start} enabled seen={seen} />);
    await settle();
    expect(start).toHaveBeenCalledTimes(1);
  });

  test("a failing start is swallowed, leaving no lines and nothing to stop", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: DockerLogLine[][] = [];
    render(<Probe streamKey="a" start={async () => { throw new Error("nope"); }} seen={seen} />);
    await settle();

    expect(seen[seen.length - 1]).toEqual([]);
    expect(h.stopped).toEqual([]);
    err.mockRestore();
  });
});
