import { describe, it, expect, vi } from "vitest";
import { buildDockerMcpTools } from "./mcpTools";
import type { PluginAPI } from "@/plugins/api";

const api = (overrides: Record<string, unknown> = {}) =>
  ({
    sessions: {
      list: () => [
        { id: "s1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "h" },
        { id: "s2", type: "local", status: "connected", connectionId: "", connectionName: "local", localShell: "/bin/bash" },
        { id: "s3", type: "serial", status: "connected", connectionId: "c3", connectionName: "ttyUSB0" },
      ],
    },
    docker: {
      containers: { list: vi.fn(async () => [{ id: "abc" }]), action: vi.fn(async () => undefined) },
      images: { list: vi.fn(async () => []) },
      volumes: { list: vi.fn(async () => []) },
      networks: { list: vi.fn(async () => []) },
      stacks: { list: vi.fn(async () => []) },
      logs: { start: vi.fn(async () => "st1"), stop: vi.fn(async () => undefined), on: vi.fn(async () => () => {}) },
      ...(overrides.docker as object),
    },
  }) as unknown as PluginAPI;

describe("the docker MCP tools", () => {
  it("contributes exactly the seven curated verbs", () => {
    expect(buildDockerMcpTools(api()).map((t) => t.name)).toEqual([
      "container_list", "container_action", "container_logs",
      "image_list", "volume_list", "network_list", "stack_list",
    ]);
  });

  it("marks the read verbs non-mutating and the action verb mutating", () => {
    const tools = buildDockerMcpTools(api());
    expect(tools.find((t) => t.name === "container_list")!.mutating).toBe(false);
    expect(tools.find((t) => t.name === "container_action")!.mutating).toBe(true);
  });

  it("resolves a remote target from a bare sessionId", async () => {
    const a = api();
    await buildDockerMcpTools(a).find((t) => t.name === "container_list")!.execute({ sessionId: "s1" });
    expect(a.docker.containers.list).toHaveBeenCalledWith({
      sessionId: "s1", isRemote: true, localShell: null,
    });
  });

  it("resolves a local target with its shell", async () => {
    const a = api();
    await buildDockerMcpTools(a).find((t) => t.name === "container_list")!.execute({ sessionId: "s2" });
    expect(a.docker.containers.list).toHaveBeenCalledWith({
      sessionId: "s2", isRemote: false, localShell: "/bin/bash",
    });
  });

  // A serial session's "target" is a physical device; a docker command would be
  // written to it verbatim.
  it("refuses a serial session by type", async () => {
    await expect(
      buildDockerMcpTools(api()).find((t) => t.name === "container_list")!.execute({ sessionId: "s3" }),
    ).rejects.toThrow(/serial/);
  });

  it("refuses an unknown session by name rather than silently acting locally", async () => {
    await expect(
      buildDockerMcpTools(api()).find((t) => t.name === "container_list")!.execute({ sessionId: "nope" }),
    ).rejects.toThrow(/nope/);
  });

  describe("container_logs", () => {
    it("stops the stream and unsubscribes the listener once the quiet timeout fires with no lines", async () => {
      vi.useFakeTimers();
      const unsubscribe = vi.fn();
      const a = api({ docker: { logs: { start: vi.fn(async () => "st1"), stop: vi.fn(async () => undefined), on: vi.fn(async () => unsubscribe) } } });
      const result = buildDockerMcpTools(a).find((t) => t.name === "container_logs")!.execute({
        sessionId: "s1", containerId: "c1",
      });
      await vi.advanceTimersByTimeAsync(1500);
      await result;
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(a.docker.logs.stop).toHaveBeenCalledWith("st1");
      vi.useRealTimers();
    });

    it("still stops the stream when on() rejects, with nothing to unsubscribe", async () => {
      const stop = vi.fn(async () => undefined);
      const a = api({ docker: { logs: { start: vi.fn(async () => "st1"), stop, on: vi.fn(async () => { throw new Error("ipc failed"); }) } } });
      await expect(
        buildDockerMcpTools(a).find((t) => t.name === "container_logs")!.execute({ sessionId: "s1", containerId: "c1" }),
      ).rejects.toThrow(/ipc failed/);
      expect(stop).toHaveBeenCalledWith("st1");
    });
  });
});
