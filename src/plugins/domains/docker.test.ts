import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { createDockerAPI } from "./docker";

const fakeStreams = {
  start: vi.fn(async () => "log-1"),
  stop: vi.fn(async () => {}),
  on: vi.fn(async () => () => {}),
};

const T = { sessionId: "s1", isRemote: true, localShell: null };

describe("createDockerAPI", () => {
  beforeEach(() => {
    invoke.mockReset();
    fakeStreams.start.mockClear();
    fakeStreams.stop.mockClear();
    fakeStreams.on.mockClear();
  });

  test("containers.list always requests all containers", async () => {
    invoke.mockResolvedValue([]);
    await createDockerAPI(fakeStreams).containers.list(T);
    expect(invoke).toHaveBeenCalledWith("docker_list_containers", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      all: true,
    });
  });

  test("containers.action spreads the target and forwards the action", async () => {
    invoke.mockResolvedValue(undefined);
    await createDockerAPI(fakeStreams).containers.action(T, "c1", "restart");
    expect(invoke).toHaveBeenCalledWith("docker_container_action", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      containerId: "c1",
      action: "restart",
    });
  });

  // The backend param is named "image" (it reconstructs `docker run` from the
  // container's image ref), not "command" — the public method name wins, the
  // wire key follows the real command.
  test("containers.runCommand sends the command arg under the backend's 'image' key", async () => {
    invoke.mockResolvedValue("docker run …");
    await createDockerAPI(fakeStreams).containers.runCommand(T, "c1", "nginx:latest");
    expect(invoke).toHaveBeenCalledWith("docker_container_run_command", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      containerId: "c1",
      image: "nginx:latest",
    });
  });

  test("images.update forwards the recreate flag", async () => {
    invoke.mockResolvedValue({ image_updated: true, recreated: [], manual: [] });
    await createDockerAPI(fakeStreams).images.update(T, "nginx:latest", true);
    expect(invoke).toHaveBeenCalledWith("docker_update_image", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      image: "nginx:latest",
      recreate: true,
    });
  });

  test("each prune verb targets its own command", async () => {
    invoke.mockResolvedValue("");
    const api = createDockerAPI(fakeStreams);
    await api.images.prune(T);
    await api.volumes.prune(T);
    await api.networks.prune(T);
    await api.system.prune(T);
    expect(invoke.mock.calls.map((c) => c[0])).toEqual([
      "docker_prune_images",
      "docker_prune_volumes",
      "docker_prune_networks",
      "docker_system_prune",
    ]);
  });

  test("logs.start uses the docker-logs stream kind", async () => {
    await createDockerAPI(fakeStreams).logs.start(T, "c1", 100);
    expect(fakeStreams.start).toHaveBeenCalledWith("docker-logs", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      containerId: "c1",
      tail: 100,
    });
  });

  // Real backend command takes "stackName", not "stack" — src/plugins/docker/services.ts
  // dockerStartStackLogStream confirms the exact key (Step 1 real-signature check).
  test("logs.startStack uses the stack stream kind", async () => {
    await createDockerAPI(fakeStreams).logs.startStack(T, "web", 50);
    expect(fakeStreams.start).toHaveBeenCalledWith("docker-stack-logs", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      stackName: "web",
      tail: 50,
    });
  });

  test("logs.stop and logs.on delegate to the streams primitive", async () => {
    const api = createDockerAPI(fakeStreams);
    await api.logs.stop("log-1");
    expect(fakeStreams.stop).toHaveBeenCalledWith("log-1");
    const cb = vi.fn();
    await api.logs.on("log-1", cb);
    expect(fakeStreams.on).toHaveBeenCalledWith("log-1", cb);
  });

  test("exec.open invokes the remote exec-session command", async () => {
    invoke.mockResolvedValue("exec-1");
    await expect(createDockerAPI(fakeStreams).exec.open(T, "c1")).resolves.toBe("exec-1");
    expect(invoke).toHaveBeenCalledWith("docker_open_exec_session", {
      sourceSessionId: "s1",
      containerId: "c1",
    });
  });
});
