import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ContainerAction,
  DockerContainer,
  DockerImage,
  DockerLogLine,
  DockerNetwork,
  DockerVolume,
} from "./types";

export function dockerListContainers(
  sessionId: string,
  isRemote: boolean,
  all: boolean,
): Promise<DockerContainer[]> {
  return invoke("docker_list_containers", { sessionId, isRemote, all });
}

export function dockerListImages(
  sessionId: string,
  isRemote: boolean,
): Promise<DockerImage[]> {
  return invoke("docker_list_images", { sessionId, isRemote });
}

export function dockerListVolumes(
  sessionId: string,
  isRemote: boolean,
): Promise<DockerVolume[]> {
  return invoke("docker_list_volumes", { sessionId, isRemote });
}

export function dockerListNetworks(
  sessionId: string,
  isRemote: boolean,
): Promise<DockerNetwork[]> {
  return invoke("docker_list_networks", { sessionId, isRemote });
}

export function dockerContainerAction(
  sessionId: string,
  isRemote: boolean,
  containerId: string,
  action: ContainerAction,
): Promise<void> {
  return invoke("docker_container_action", { sessionId, isRemote, containerId, action });
}

export function dockerStartLogStream(
  sessionId: string,
  isRemote: boolean,
  containerId: string,
  tail: number,
): Promise<string> {
  return invoke("docker_start_log_stream", { sessionId, isRemote, containerId, tail });
}

export function dockerStopLogStream(streamId: string): Promise<void> {
  return invoke("docker_stop_log_stream", { streamId });
}

export function dockerRemoveImage(sessionId: string, isRemote: boolean, imageId: string): Promise<void> {
  return invoke("docker_remove_image", { sessionId, isRemote, imageId });
}

export function dockerRemoveVolume(sessionId: string, isRemote: boolean, volumeName: string): Promise<void> {
  return invoke("docker_remove_volume", { sessionId, isRemote, volumeName });
}

export function dockerRemoveNetwork(sessionId: string, isRemote: boolean, networkId: string): Promise<void> {
  return invoke("docker_remove_network", { sessionId, isRemote, networkId });
}

export function dockerPruneImages(sessionId: string, isRemote: boolean): Promise<string> {
  return invoke("docker_prune_images", { sessionId, isRemote });
}

export function dockerPruneVolumes(sessionId: string, isRemote: boolean): Promise<string> {
  return invoke("docker_prune_volumes", { sessionId, isRemote });
}

export function dockerPruneNetworks(sessionId: string, isRemote: boolean): Promise<string> {
  return invoke("docker_prune_networks", { sessionId, isRemote });
}

export function dockerSystemPrune(sessionId: string, isRemote: boolean): Promise<string> {
  return invoke("docker_system_prune", { sessionId, isRemote });
}

export function onDockerLog(
  streamId: string,
  cb: (line: DockerLogLine) => void,
): Promise<UnlistenFn> {
  return listen<DockerLogLine>(`docker:log:${streamId}`, ({ payload }) => cb(payload));
}
