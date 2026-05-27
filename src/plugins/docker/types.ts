export interface DockerContainer {
  id: string;
  names: string[];
  image: string;
  status: string;
  state: string;
  ports: PortMapping[];
  created: number;
}

export interface PortMapping {
  host_ip: string | null;
  host_port: number | null;
  container_port: number;
  protocol: string;
}

export interface DockerImage {
  id: string;
  repo_tags: string[];
  size: number;
  created: number;
}

export interface DockerVolume {
  name: string;
  driver: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
}

export interface DockerLogLine {
  line: string;
  stream: "stdout" | "stderr";
  ts: number;
}

export interface DockerStack {
  name: string;
  status: string;
  config_files: string[];
  running: number;
  exited: number;
  paused: number;
  total: number;
}

export interface DockerStackService {
  id: string;
  name: string;
  project: string;
  service: string;
  image: string;
  state: string;
  status: string;
  ports: PortMapping[];
}

export type ContainerAction = "start" | "stop" | "restart" | "remove" | "pause" | "unpause";

export type StackAction = "up" | "stop" | "restart" | "down";

export type DockerView = "containers" | "images" | "volumes" | "networks" | "stacks" | "logs";

export interface DockerState {
  view: DockerView;
  containers: DockerContainer[];
  images: DockerImage[];
  volumes: DockerVolume[];
  networks: DockerNetwork[];
  stacks: DockerStack[];
  stackServices: DockerStackService[];
  selectedStackName: string | null;
  logsContainerId: string | null;
  logsStackName: string | null;
  logsReturnView: DockerView;
  logLines: DockerLogLine[];
  loading: boolean;
  error: string | null;
  showStopped: boolean;
}
