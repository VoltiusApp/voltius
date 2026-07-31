import type { DockerTarget } from "@/plugins/api";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getDockerApi } from "./runtime";
import type { DockerListService } from "./useDockerList";
import type {
  ContainerAction,
  DockerContainer,
  DockerImage,
  DockerLogLine,
  DockerNetwork,
  DockerStack,
  DockerStackService,
  DockerVolume,
  ImageUpdateStatus,
  RecreateResult,
  StackAction,
} from "./types";

function docker() {
  const api = getDockerApi();
  if (!api) throw new Error("[docker] plugin API not initialized");
  return api.docker;
}

export function dockerListContainers(target: DockerTarget): Promise<DockerContainer[]> {
  return docker().containers.list(target) as Promise<DockerContainer[]>;
}

export function dockerListImages(target: DockerTarget): Promise<DockerImage[]> {
  return docker().images.list(target) as Promise<DockerImage[]>;
}

export function dockerListVolumes(target: DockerTarget): Promise<DockerVolume[]> {
  return docker().volumes.list(target) as Promise<DockerVolume[]>;
}

export function dockerListNetworks(target: DockerTarget): Promise<DockerNetwork[]> {
  return docker().networks.list(target) as Promise<DockerNetwork[]>;
}

export function dockerListStacks(target: DockerTarget): Promise<DockerStack[]> {
  return docker().stacks.list(target) as Promise<DockerStack[]>;
}

export function dockerListStackServices(target: DockerTarget, stackName: string): Promise<DockerStackService[]> {
  return docker().stacks.services(target, stackName) as Promise<DockerStackService[]>;
}

export function dockerContainerAction(target: DockerTarget, containerId: string, action: ContainerAction): Promise<void> {
  return docker().containers.action(target, containerId, action);
}

export function dockerStackUpdate(target: DockerTarget, stackName: string): Promise<void> {
  return docker().stacks.update(target, stackName);
}

export function dockerStackAction(target: DockerTarget, stackName: string, action: StackAction): Promise<void> {
  return docker().stacks.action(target, stackName, action);
}

export function dockerStartStackLogStream(target: DockerTarget, stackName: string, tail: number): Promise<string> {
  return docker().logs.startStack(target, stackName, tail);
}

export function dockerStartLogStream(target: DockerTarget, containerId: string, tail: number): Promise<string> {
  return docker().logs.start(target, containerId, tail);
}

export function dockerStopLogStream(streamId: string): Promise<void> {
  return docker().logs.stop(streamId);
}

export function dockerRemoveImage(target: DockerTarget, imageId: string): Promise<void> {
  return docker().images.remove(target, imageId);
}

export function dockerCheckImageUpdate(target: DockerTarget, image: string): Promise<ImageUpdateStatus> {
  return docker().images.checkUpdate(target, image) as Promise<ImageUpdateStatus>;
}

export function dockerPullImage(target: DockerTarget, image: string): Promise<void> {
  return docker().images.pull(target, image);
}

export function dockerContainerRunCommand(target: DockerTarget, containerId: string, command: string): Promise<string> {
  return docker().containers.runCommand(target, containerId, command);
}

export function dockerRecreateImageContainers(target: DockerTarget, image: string): Promise<RecreateResult> {
  return docker().images.recreateContainers(target, image) as Promise<RecreateResult>;
}

/**
 * Pull `image` and, when `recreate` is set, recreate the containers that were
 * using it — captured before the pull so the tag move doesn't hide them.
 */
export function dockerUpdateImage(target: DockerTarget, image: string, recreate: boolean): Promise<RecreateResult> {
  return docker().images.update(target, image, recreate) as Promise<RecreateResult>;
}

export function dockerRemoveVolume(target: DockerTarget, volumeName: string): Promise<void> {
  return docker().volumes.remove(target, volumeName);
}

export function dockerRemoveNetwork(target: DockerTarget, networkId: string): Promise<void> {
  return docker().networks.remove(target, networkId);
}

export function dockerPruneImages(target: DockerTarget): Promise<string> {
  return docker().images.prune(target);
}

export function dockerPruneVolumes(target: DockerTarget): Promise<string> {
  return docker().volumes.prune(target);
}

export function dockerPruneNetworks(target: DockerTarget): Promise<string> {
  return docker().networks.prune(target);
}

export function dockerSystemPrune(target: DockerTarget): Promise<string> {
  return docker().system.prune(target);
}

export function onDockerLog(streamId: string, cb: (line: DockerLogLine) => void): Promise<UnlistenFn> {
  return docker().logs.on(streamId, cb);
}

export function createDockerListService(): DockerListService {
  return {
    list: dockerListContainers,
    action: dockerContainerAction,
    openExecTerminal: async (target, containerId, containerName) => {
      const api = getDockerApi();
      if (!api) throw new Error("[docker] plugin API not initialized");
      await api.docker.exec.open(target, containerId, containerName);
      api.ui.setActiveNav("terminal");
    },
  };
}

/** Mobile variant of createDockerListService — same transport, but the exec-open
 *  flow brings the mobile shell's terminal tab forward instead of the desktop nav. */
export function createMobileDockerListService(): DockerListService {
  return {
    list: dockerListContainers,
    action: dockerContainerAction,
    openExecTerminal: async (target, containerId, containerName) => {
      const api = getDockerApi();
      if (!api) throw new Error("[docker] plugin API not initialized");
      await api.docker.exec.open(target, containerId, containerName);
      api.ui.focusMobileTerminal();
    },
  };
}
