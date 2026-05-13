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
  localShell: string | null,
  all: boolean,
): Promise<DockerContainer[]> {
  return invoke("docker_list_containers", { sessionId, isRemote, localShell, all });
}

export function dockerListImages(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
): Promise<DockerImage[]> {
  return invoke("docker_list_images", { sessionId, isRemote, localShell });
}

export function dockerListVolumes(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
): Promise<DockerVolume[]> {
  return invoke("docker_list_volumes", { sessionId, isRemote, localShell });
}

export function dockerListNetworks(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
): Promise<DockerNetwork[]> {
  return invoke("docker_list_networks", { sessionId, isRemote, localShell });
}

export function dockerContainerAction(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
  containerId: string,
  action: ContainerAction,
): Promise<void> {
  return invoke("docker_container_action", { sessionId, isRemote, localShell, containerId, action });
}

export function dockerStartLogStream(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
  containerId: string,
  tail: number,
): Promise<string> {
  return invoke("docker_start_log_stream", { sessionId, isRemote, localShell, containerId, tail });
}

export function dockerStopLogStream(streamId: string): Promise<void> {
  return invoke("docker_stop_log_stream", { streamId });
}

export function dockerRemoveImage(sessionId: string, isRemote: boolean, localShell: string | null, imageId: string): Promise<void> {
  return invoke("docker_remove_image", { sessionId, isRemote, localShell, imageId });
}

export function dockerRemoveVolume(sessionId: string, isRemote: boolean, localShell: string | null, volumeName: string): Promise<void> {
  return invoke("docker_remove_volume", { sessionId, isRemote, localShell, volumeName });
}

export function dockerRemoveNetwork(sessionId: string, isRemote: boolean, localShell: string | null, networkId: string): Promise<void> {
  return invoke("docker_remove_network", { sessionId, isRemote, localShell, networkId });
}

export function dockerPruneImages(sessionId: string, isRemote: boolean, localShell: string | null): Promise<string> {
  return invoke("docker_prune_images", { sessionId, isRemote, localShell });
}

export function dockerPruneVolumes(sessionId: string, isRemote: boolean, localShell: string | null): Promise<string> {
  return invoke("docker_prune_volumes", { sessionId, isRemote, localShell });
}

export function dockerPruneNetworks(sessionId: string, isRemote: boolean, localShell: string | null): Promise<string> {
  return invoke("docker_prune_networks", { sessionId, isRemote, localShell });
}

export function dockerSystemPrune(sessionId: string, isRemote: boolean, localShell: string | null): Promise<string> {
  return invoke("docker_system_prune", { sessionId, isRemote, localShell });
}

export function onDockerLog(
  streamId: string,
  cb: (line: DockerLogLine) => void,
): Promise<UnlistenFn> {
  return listen<DockerLogLine>(`docker:log:${streamId}`, ({ payload }) => cb(payload));
}
