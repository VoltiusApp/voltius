import { invoke } from "@tauri-apps/api/core";
import type { DockerAPI, DockerTarget, StreamsAPI } from "../api";

const t = (target: DockerTarget) => ({ ...target });

export function createDockerAPI(streams: StreamsAPI): DockerAPI {
  return {
    containers: {
      // "all" is always true at every real call site — hardcoded so the public
      // shape doesn't leak a backend param no caller varies.
      list: (target) => invoke("docker_list_containers", { ...t(target), all: true }),
      action: (target, containerId, action) =>
        invoke("docker_container_action", { ...t(target), containerId, action }),
      // Backend param is "image" (it rebuilds `docker run` from the container's
      // image ref) — the public method keeps the "command" name, the wire key doesn't.
      runCommand: (target, containerId, command) =>
        invoke("docker_container_run_command", { ...t(target), containerId, image: command }),
    },
    images: {
      list: (target) => invoke("docker_list_images", t(target)),
      remove: (target, imageId) => invoke("docker_remove_image", { ...t(target), imageId }),
      pull: (target, image) => invoke("docker_pull_image", { ...t(target), image }),
      checkUpdate: (target, imageId) =>
        invoke("docker_check_image_update", { ...t(target), image: imageId }),
      update: (target, imageId, recreate) =>
        invoke("docker_update_image", { ...t(target), image: imageId, recreate }),
      recreateContainers: (target, imageId) =>
        invoke("docker_recreate_image_containers", { ...t(target), image: imageId }),
      prune: (target) => invoke("docker_prune_images", t(target)),
    },
    volumes: {
      list: (target) => invoke("docker_list_volumes", t(target)),
      remove: (target, name) => invoke("docker_remove_volume", { ...t(target), volumeName: name }),
      prune: (target) => invoke("docker_prune_volumes", t(target)),
    },
    networks: {
      list: (target) => invoke("docker_list_networks", t(target)),
      remove: (target, id) => invoke("docker_remove_network", { ...t(target), networkId: id }),
      prune: (target) => invoke("docker_prune_networks", t(target)),
    },
    stacks: {
      list: (target) => invoke("docker_list_stacks", t(target)),
      services: (target, stack) =>
        invoke("docker_list_stack_services", { ...t(target), stackName: stack }),
      action: (target, stack, action) =>
        invoke("docker_stack_action", { ...t(target), stackName: stack, action }),
      update: (target, stack) => invoke("docker_stack_update", { ...t(target), stackName: stack }),
    },
    logs: {
      start: (target, containerId, tail) =>
        streams.start("docker-logs", { ...t(target), containerId, tail }),
      startStack: (target, stack, tail) =>
        streams.start("docker-stack-logs", { ...t(target), stackName: stack, tail }),
      stop: (streamId) => streams.stop(streamId),
      on: (streamId, cb) => streams.on(streamId, cb),
    },
    system: {
      prune: (target) => invoke("docker_system_prune", t(target)),
    },
    exec: {
      // Remote-only leaf: opens a docker-exec PTY channel on the existing SSH
      // connection. The local-shell branch has no equivalent backend command (it
      // spawns a client-side local PTY) and the session-store bookkeeping both
      // branches need lives in runtime.ts, mirroring proxmox's openShell wiring.
      open: (target, containerId) =>
        invoke("docker_open_exec_session", { sourceSessionId: target.sessionId, containerId }),
    },
  };
}
