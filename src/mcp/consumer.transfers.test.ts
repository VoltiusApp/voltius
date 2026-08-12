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
