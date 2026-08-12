import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTransferQueueStore } from "./transferQueueStore";

vi.mock("@/services/sftp", () => ({
  sftpCancelTransfer: vi.fn(async () => {}),
  onTransferProgress: vi.fn(async () => () => {}),
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
    await store().runTransfer("a.txt", "→", async () => {}, undefined, false, owner);
    expect(store().transfers[0].owner).toEqual(owner);
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
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("carries the owner and accelerated flag onto the retry", async () => {
    const owner = { clientId: "c-1", clientName: "Claude Code", since: 1 };
    await store().runTransfer("a.txt", "→", vi.fn().mockRejectedValue(new Error("x")), undefined, true, owner);
    store().retryTransfer(store().transfers[0].id);
    await vi.waitFor(() => expect(store().transfers).toHaveLength(2));
    expect(store().transfers[0].owner).toEqual(owner);
    expect(store().transfers[0].accelerated).toBe(true);
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
});

describe("canRetry", () => {
  it("is true only for cancelled and error", async () => {
    await store().runTransfer("a.txt", "→", vi.fn().mockRejectedValue(new Error("x")));
    expect(store().canRetry(store().transfers[0].id)).toBe(true);
    expect(store().canRetry("nope")).toBe(false);
  });
});
