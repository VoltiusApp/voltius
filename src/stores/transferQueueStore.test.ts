// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTransferQueueStore } from "./transferQueueStore";

import { sftpMarkResume } from "@/services/sftp";

const skipListeners = new Map<string, (path: string) => void>();
const { listeners, listen } = vi.hoisted(() => {
  const listeners = new Map<string, (v: never) => void>();
  const listen = (kind: string) => async (id: string, cb: (v: never) => void) => {
    listeners.set(`${kind}:${id}`, cb);
    return () => listeners.delete(`${kind}:${id}`);
  };
  return { listeners, listen };
});
const fire = <T,>(kind: string, id: string, v: T) => (listeners.get(`${kind}:${id}`) as (v: T) => void)(v);

vi.mock("@/services/sftp", () => ({
  sftpCancelTransfer: vi.fn(async () => {}),
  sftpMarkResume: vi.fn(async () => {}),
  onTransferProgress: vi.fn((id: string, cb: (v: never) => void) => listen("progress")(id, cb)),
  onTransferResumed: vi.fn((id: string, cb: (v: never) => void) => listen("resumed")(id, cb)),
  onTransferWaiting: vi.fn((id: string, cb: (v: never) => void) => listen("waiting")(id, cb)),
  onTransferAccel: vi.fn((id: string, cb: (v: never) => void) => listen("accel")(id, cb)),
  onTransferSkipped: vi.fn(async (id: string, cb: (path: string) => void) => {
    skipListeners.set(id, cb);
    return () => skipListeners.delete(id);
  }),
}));

const store = () => useTransferQueueStore.getState();

beforeEach(() => {
  useTransferQueueStore.setState({ transfers: [], pending: null });
});

describe("runTransfer owner", () => {
  it("leaves owner absent for a user-started transfer", async () => {
    await store().runTransfer("a.txt", "→", async () => {});
    expect(store().transfers[0].owner).toBeUndefined();
  });

  it("stamps the owner it was given", async () => {
    const owner = { clientId: "c-1", clientName: "Claude Code", since: 1 };
    await store().runTransfer("a.txt", "→", async () => {}, undefined, undefined, owner);
    expect(store().transfers[0].owner).toEqual(owner);
  });
});

describe("skipped names", () => {
  it("finishes done and lists every name the backend skipped", async () => {
    await store().runTransfer("logs", "←", async (tid) => {
      skipListeners.get(tid)!("/var/log/10:30.log");
      skipListeners.get(tid)!("/var/log/a\\b");
    });
    const [tr] = store().transfers;
    expect(tr.status).toBe("done");
    expect(tr.skipped).toEqual(["/var/log/10:30.log", "/var/log/a\\b"]);
    expect(skipListeners.has(tr.id)).toBe(false);
  });

  it("leaves skipped absent when nothing was skipped", async () => {
    await store().runTransfer("a.txt", "←", async () => {});
    expect(store().transfers[0].skipped).toBeUndefined();
  });
});

describe("retryTransfer", () => {
  it("re-runs a failed transfer under a new id and keeps the original row", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(undefined);
    await store().runTransfer("a.txt", "→", fn);
    const failed = store().transfers[0];
    expect(failed.status).toBe("error");

    store().retryTransfer(failed.id);
    await vi.waitFor(() => expect(store().transfers).toHaveLength(2));

    const [fresh, original] = store().transfers;
    expect(fresh.id).not.toBe(failed.id);
    expect(fresh.label).toBe("a.txt");
    expect(original.id).toBe(failed.id);
    expect(original.status).toBe("error");
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });

  it("carries the owner and tar mode onto the retry", async () => {
    const owner = { clientId: "c-1", clientName: "Claude Code", since: 1 };
    await store().runTransfer("a.txt", "→", vi.fn().mockRejectedValue(new Error("x")), undefined, "tar", owner);
    store().retryTransfer(store().transfers[0].id);
    await vi.waitFor(() => expect(store().transfers).toHaveLength(2));
    expect(store().transfers[0].owner).toEqual(owner);
    expect(store().transfers[0].accel).toBe("tar");
  });

  it("retries a cancelled transfer", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("cancelled by user"));
    await store().runTransfer("a.txt", "→", fn);
    expect(store().transfers[0].status).toBe("cancelled");
    store().retryTransfer(store().transfers[0].id);
    await vi.waitFor(() => expect(store().transfers).toHaveLength(2));
  });

  it("is a no-op on a running or finished transfer, and on an unknown id", async () => {
    await store().runTransfer("a.txt", "→", async () => {});
    expect(store().transfers[0].status).toBe("done");
    store().retryTransfer(store().transfers[0].id);
    store().retryTransfer("nope");
    expect(store().transfers).toHaveLength(1);
  });

  it("survives cap eviction when it is the oldest row in a full queue", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    await store().runTransfer("oldest.txt", "→", fn);
    const oldest = store().transfers[0];
    for (let i = 0; i < 29; i++) {
      await store().runTransfer(`f${i}.txt`, "→", async () => {});
    }
    expect(store().transfers).toHaveLength(30);
    expect(store().transfers[store().transfers.length - 1].id).toBe(oldest.id);

    store().retryTransfer(oldest.id);
    await vi.waitFor(() => expect(store().transfers.some((t) => t.label === "oldest.txt" && t.id !== oldest.id)).toBe(true));

    expect(store().transfers).toHaveLength(30);
    expect(store().transfers.find((t) => t.id === oldest.id)).toBeDefined();
  });
});

describe("canRetry", () => {
  it("is true only for cancelled and error", async () => {
    await store().runTransfer("a.txt", "→", vi.fn().mockRejectedValue(new Error("x")));
    expect(store().canRetry(store().transfers[0].id)).toBe(true);
    expect(store().canRetry("nope")).toBe(false);
  });
});

describe("cancelTransfer", () => {
  it("refuses on a done transfer and leaves it done", async () => {
    await store().runTransfer("a.txt", "→", async () => {});
    const [tr] = store().transfers;
    expect(tr.status).toBe("done");

    expect(store().cancelTransfer(tr.id)).toBe(false);
    expect(store().transfers[0].status).toBe("done");
  });

  it("refuses on an unknown id", () => {
    expect(store().cancelTransfer("nope")).toBe(false);
  });

  it("cancels a running transfer and returns true", async () => {
    let releaseTransfer!: () => void;
    const gate = new Promise<void>((_, reject) => (releaseTransfer = () => reject(new Error("cancelled by user"))));
    const done = store().runTransfer("a.txt", "→", async () => gate);
    const [tr] = store().transfers;
    expect(tr.status).toBe("running");

    expect(store().cancelTransfer(tr.id)).toBe(true);
    expect(store().transfers[0].status).toBe("cancelled");
    releaseTransfer();
    await done;
  });
});

describe("canRetry after a cancel", () => {
  it("stays false until the transfer has settled", async () => {
    // Mirrors what the backend actually does on cancel: the in-flight fn
    // rejects with a "cancelled" error once released, same as cancelTransfer
    // itself never resolves the row directly.
    let releaseTransfer!: () => void;
    const gate = new Promise<void>((_, reject) => (releaseTransfer = () => reject(new Error("cancelled by user"))));
    const done = store().runTransfer("a.txt", "→", async () => gate);
    const [tr] = store().transfers;

    store().cancelTransfer(tr.id);
    // The row is labelled "cancelled" synchronously, but runTransfer's
    // finally hasn't run yet — the row is not settled, so it must not be
    // retryable while a writer could still be flushing to the destination.
    expect(store().transfers[0].status).toBe("cancelled");
    expect(store().canRetry(tr.id)).toBe(false);

    releaseTransfer();
    await done;
    expect(store().canRetry(tr.id)).toBe(true);
  });
});

describe("resume", () => {
  beforeEach(() => vi.mocked(sftpMarkResume).mockClear());

  it("marks a retry as a resume before running it again", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("link down")).mockResolvedValueOnce(undefined);
    await store().runTransfer("v.mp4", "→", fn);
    store().retryTransfer(store().transfers[0].id);
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    const retriedId = fn.mock.calls[1][0];
    expect(sftpMarkResume).toHaveBeenCalledWith(retriedId);
    expect(vi.mocked(sftpMarkResume).mock.invocationCallOrder[0]).toBeLessThan(fn.mock.invocationCallOrder[1]);
  });

  it("does not mark a first run as a resume", async () => {
    await store().runTransfer("v.mp4", "→", async () => {});
    expect(sftpMarkResume).not.toHaveBeenCalled();
  });

  it("shows where a transfer resumed and while it waits for the link", async () => {
    const seen: object[] = [];
    await store().runTransfer("v.mp4", "→", async (tid) => {
      fire("waiting", tid, true);
      seen.push({ ...store().transfers[0] });
      fire("waiting", tid, false);
      fire("resumed", tid, 4_000_000_000);
      seen.push({ ...store().transfers[0] });
    });
    expect(store().transfers[0].status).toBe("done");
    expect(seen[0]).toMatchObject({ waiting: true, status: "running" });
    expect(seen[1]).toMatchObject({ waiting: false, resumedAt: 4_000_000_000, transferred: 4_000_000_000 });
  });

  it("measures speed from the resume point, not from zero", async () => {
    vi.useFakeTimers();
    let speed: number | undefined;
    try {
      await store().runTransfer("v.mp4", "→", async (tid) => {
        fire("resumed", tid, 4_000_000_000);
        fire("progress", tid, { transferred: 4_000_000_000, total: 5_000_000_000 });
        vi.advanceTimersByTime(2000);
        fire("progress", tid, { transferred: 4_020_000_000, total: 5_000_000_000 });
        speed = store().transfers[0].speed;
      });
    } finally {
      vi.useRealTimers();
    }
    expect(store().transfers[0].status).toBe("done");
    expect(speed).toBeCloseTo(10_000_000, -5);
  });

  it("switches the accel badge when the backend goes per file", async () => {
    await store().runTransfer("dir", "→", async (tid) => {
      fire("accel", tid, "perFile");
    }, undefined, "tar");
    expect(store().transfers[0].accel).toBe("perFile");
  });

  it("clears waiting once a transfer fails", async () => {
    await store().runTransfer("v.mp4", "→", async (tid) => {
      fire("waiting", tid, true);
      throw new Error("connection lost");
    });
    expect(store().transfers[0]).toMatchObject({ status: "error", waiting: false, error: "connection lost" });
  });
});
