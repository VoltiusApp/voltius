import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMcpTools } from "./consumer";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import type { PluginAPI } from "@/plugins/api";

vi.mock("@/services/sftp", () => ({
  sftpCancelTransfer: vi.fn(async () => {}),
  onTransferProgress: vi.fn(async () => () => {}),
}));

const owner = { clientId: "c-1", clientName: "Claude Code", since: 1 };

function makeApi(transfer = vi.fn(async () => {})) {
  return {
    sftp: { transfer },
    sessions: { list: () => [] },
    audit: { record: vi.fn() },
  } as unknown as PluginAPI;
}

beforeEach(() => {
  useTransferQueueStore.setState({ transfers: [], pending: null });
});

const transferFile = (api: PluginAPI) =>
  buildMcpTools(api, new Set() as never, () => owner).find((t) => t.name === "transfer_file")!;

describe("transfer_file over MCP", () => {
  it("lands in the app's transfer queue, stamped with the client", async () => {
    await transferFile(makeApi()).execute({
      fromTarget: "local", fromPath: "/tmp/a.txt", toTarget: "c-1", toPath: "/tmp/a.txt",
    });
    const [tr] = useTransferQueueStore.getState().transfers;
    expect(tr.owner).toEqual(owner);
    expect(tr.status).toBe("done");
    expect(tr.label).toContain("a.txt");
  });

  it("is retryable after a failure", async () => {
    const transfer = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(undefined);
    await transferFile(makeApi(transfer)).execute({
      fromTarget: "local", fromPath: "/tmp/a.txt", toTarget: "c-1", toPath: "/tmp/a.txt",
    });
    const failed = useTransferQueueStore.getState().transfers[0];
    expect(failed.status).toBe("error");
    expect(useTransferQueueStore.getState().canRetry(failed.id)).toBe(true);
  });

  it("still queues the transfer when no owner is supplied", async () => {
    const tool = buildMcpTools(makeApi(), new Set() as never).find((t) => t.name === "transfer_file")!;
    await tool.execute({ fromTarget: "local", fromPath: "/tmp/a.txt", toTarget: "c-1", toPath: "/tmp/a.txt" });
    const [tr] = useTransferQueueStore.getState().transfers;
    expect(tr.owner).toBeUndefined();
  });

  it("runs the backend transfer under the queue row's own id, so progress events reach it", async () => {
    const transfer = vi.fn(async () => {});
    await transferFile(makeApi(transfer)).execute({
      fromTarget: "local", fromPath: "/tmp/a.txt", toTarget: "c-1", toPath: "/tmp/a.txt",
    });
    const [tr] = useTransferQueueStore.getState().transfers;
    expect(transfer).toHaveBeenCalledWith(expect.anything(), expect.anything(), tr.id);
  });

  it("gives two overlapping transfers their own id apiece, with no crossing", async () => {
    // Each call resolves on its own gate so both are in flight together —
    // the scenario a module-level "current transfer id" cannot survive.
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => (releaseFirst = r));
    const transfer = vi.fn()
      .mockImplementationOnce(async () => { await firstGate; })
      .mockImplementationOnce(async () => {});

    const api = makeApi(transfer);
    const first = transferFile(api).execute({
      fromTarget: "local", fromPath: "/tmp/first.txt", toTarget: "c-1", toPath: "/tmp/first.txt",
    });
    const second = transferFile(api).execute({
      fromTarget: "local", fromPath: "/tmp/second.txt", toTarget: "c-1", toPath: "/tmp/second.txt",
    });
    await second;
    releaseFirst();
    await first;

    const idsPassed = transfer.mock.calls.map((call) => call[2]);
    const rowIds = useTransferQueueStore.getState().transfers.map((t) => t.id);
    expect(new Set(idsPassed).size).toBe(2);
    expect(idsPassed.sort()).toEqual([...rowIds].sort());
  });

  it("rejects instead of silently resolving when the tool throws outside its own refusal handling", async () => {
    const api = {
      sftp: { transfer: vi.fn(async () => {}) },
      sessions: { list: () => [] },
      audit: {
        record: vi.fn(() => {
          throw new Error("audit sink down");
        }),
      },
    } as unknown as PluginAPI;
    await expect(
      transferFile(api).execute({
        fromTarget: "local", fromPath: "/tmp/a.txt", toTarget: "c-1", toPath: "/tmp/a.txt",
      }),
    ).rejects.toThrow("audit sink down");
    const [tr] = useTransferQueueStore.getState().transfers;
    expect(tr.status).toBe("error");
  });
});
