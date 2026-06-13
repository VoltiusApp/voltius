import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useIsAndroid } from "@/utils/platform";
import { useDockerList } from "../useDockerList";
import {
  dockerListContainers,
  dockerListImages,
  dockerListNetworks,
  dockerListStackServices,
  dockerListStacks,
  dockerListVolumes,
  dockerStartLogStream,
  dockerStartStackLogStream,
  dockerSystemPrune,
} from "../services";
import type { DockerImage, DockerNetwork, DockerStack, DockerStackService, DockerState, DockerView, DockerVolume } from "../types";
import { ContainerList } from "./ContainerList";
import { ImageList } from "./ImageList";
import { LogsView } from "./LogsView";
import { NetworkList } from "./NetworkList";
import { StackList } from "./StackList";
import { VolumeList } from "./VolumeList";
import type { DockerContainer } from "../types";

type Action =
  | { type: "SET_VIEW"; view: DockerView }
  | { type: "SET_CONTAINERS"; containers: DockerContainer[] }
  | { type: "SET_IMAGES"; images: DockerImage[] }
  | { type: "SET_VOLUMES"; volumes: DockerVolume[] }
  | { type: "SET_NETWORKS"; networks: DockerNetwork[] }
  | { type: "SET_STACKS"; stacks: DockerStack[] }
  | { type: "SET_STACK_SERVICES"; services: DockerStackService[] }
  | { type: "SELECT_STACK"; stackName: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "OPEN_LOGS"; containerId: string; containerName: string }
  | { type: "OPEN_STACK_LOGS"; stackName: string }
  | { type: "CLOSE_LOGS" }
  | { type: "TOGGLE_STOPPED" }
  | { type: "RESET" };

const initial: DockerState = {
  view: "containers",
  containers: [],
  images: [],
  volumes: [],
  networks: [],
  stacks: [],
  stackServices: [],
  selectedStackName: null,
  logsContainerId: null,
  logsStackName: null,
  logsReturnView: "containers",
  logLines: [],
  loading: false,
  error: null,
  showStopped: false,
};

function reducer(state: DockerState, action: Action): DockerState {
  switch (action.type) {
    case "SET_VIEW":
      return { ...state, view: action.view, error: null };
    case "SET_CONTAINERS":
      return { ...state, containers: action.containers, loading: false, error: null };
    case "SET_IMAGES":
      return { ...state, images: action.images, loading: false, error: null };
    case "SET_VOLUMES":
      return { ...state, volumes: action.volumes, loading: false, error: null };
    case "SET_NETWORKS":
      return { ...state, networks: action.networks, loading: false, error: null };
    case "SET_STACKS":
      return { ...state, stacks: action.stacks, loading: false, error: null };
    case "SET_STACK_SERVICES":
      return { ...state, stackServices: action.services, loading: false, error: null };
    case "SELECT_STACK":
      return { ...state, selectedStackName: action.stackName, stackServices: [], error: null };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error, loading: false };
    case "OPEN_LOGS":
      return { ...state, view: "logs", logsContainerId: action.containerId, logsStackName: null, logsReturnView: state.view, logLines: [] };
    case "OPEN_STACK_LOGS":
      return { ...state, view: "logs", logsStackName: action.stackName, logsContainerId: null, logsReturnView: state.view, logLines: [] };
    case "CLOSE_LOGS":
      return { ...state, view: state.logsReturnView, logsContainerId: null, logsStackName: null, logLines: [] };
    case "TOGGLE_STOPPED":
      return { ...state, showStopped: !state.showStopped };
    case "RESET":
      return { ...initial };
    default:
      return state;
  }
}

const TABS: { id: DockerView; label: string; icon: string }[] = [
  { id: "containers", label: "Containers", icon: "lucide:box" },
  { id: "images", label: "Images", icon: "lucide:layers" },
  { id: "volumes", label: "Volumes", icon: "lucide:hard-drive" },
  { id: "networks", label: "Networks", icon: "lucide:network" },
  { id: "stacks", label: "Stacks", icon: "lucide:boxes" },
];

export function DockerPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const [state, dispatch] = useReducer(reducer, initial);
  const [sysPruning, setSysPruning] = useState(false);
  const [sysPruneMsg, setSysPruneMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsContainerNameRef = useRef<string>("");

  const isRemote = activeSession?.type === "ssh";
  const sessionId = activeSession?.id ?? "";
  const localShell = activeSession?.type === "local" ? (activeSession.localShell ?? null) : null;
  // Android can't exec a local docker CLI — only remote (SSH) docker is supported.
  const isAndroid = useIsAndroid();

  // The exec-into-terminal flow lives in the shared hook; the list polling stays
  // reducer-driven here (enabled: false) so desktop behavior is byte-identical.
  const { openExecTerminal: handleOpenTerminal } = useDockerList(activeSession, { enabled: false });

  const fetchForView = useCallback(
    async (view: DockerView) => {
      if (!activeSession || activeSession.status !== "connected") return;
      if (isAndroid && !isRemote) return; // never attempt local docker on Android
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        switch (view) {
          case "containers": {
            const containers = await dockerListContainers(sessionId, isRemote, localShell, true);
            dispatch({ type: "SET_CONTAINERS", containers });
            break;
          }
          case "images": {
            const images = await dockerListImages(sessionId, isRemote, localShell);
            dispatch({ type: "SET_IMAGES", images });
            break;
          }
          case "volumes": {
            const volumes = await dockerListVolumes(sessionId, isRemote, localShell);
            dispatch({ type: "SET_VOLUMES", volumes });
            break;
          }
          case "networks": {
            const networks = await dockerListNetworks(sessionId, isRemote, localShell);
            dispatch({ type: "SET_NETWORKS", networks });
            break;
          }
          case "stacks": {
            const stacks = await dockerListStacks(sessionId, isRemote, localShell);
            dispatch({ type: "SET_STACKS", stacks });
            if (state.selectedStackName) {
              const services = await dockerListStackServices(sessionId, isRemote, localShell, state.selectedStackName);
              dispatch({ type: "SET_STACK_SERVICES", services });
            }
            break;
          }
          default:
            dispatch({ type: "SET_LOADING", loading: false });
        }
      } catch (e) {
        dispatch({ type: "SET_ERROR", error: String(e) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSessionId, activeSession?.status],
  );

  // Fetch + start polling when view changes (not logs)
  useEffect(() => {
    if (state.view === "logs") return;

    if (pollRef.current) clearInterval(pollRef.current);

    if (!activeSession || activeSession.status !== "connected") {
      dispatch({ type: "RESET" });
      return;
    }

    fetchForView(state.view);
    pollRef.current = setInterval(() => fetchForView(state.view), 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view, activeSessionId, activeSession?.status]);

  if (!activeSession || activeSession.status !== "connected") {
    return (
      <div className="flex items-center justify-center h-full opacity-40">
        <p className="text-sm text-(--t-text-muted)">No active session</p>
      </div>
    );
  }

  // Android sandbox can't exec a local docker CLI; only remote (SSH) docker works.
  if (isAndroid && !isRemote) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-[260px] space-y-2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-(--t-bg-card) text-(--t-text-muted) border border-(--t-border)">
            <Icon icon="mdi:docker" width={22} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-(--t-text)">Local Docker isn't available on Android</h3>
            <p className="mt-1 text-[11px] leading-4 text-(--t-text-muted)">
              Connect to a host over SSH to manage its Docker.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.view === "logs" && (state.logsContainerId || state.logsStackName)) {
    const isStackLogs = state.logsStackName !== null;
    const streamKey = isStackLogs ? state.logsStackName! : state.logsContainerId!;
    const displayName = isStackLogs ? state.logsStackName! : logsContainerNameRef.current;
    const startStream = isStackLogs
      ? (tail: number) => dockerStartStackLogStream(sessionId, isRemote, localShell, state.logsStackName!, tail)
      : (tail: number) => dockerStartLogStream(sessionId, isRemote, localShell, state.logsContainerId!, tail);
    return (
      <LogsView
        streamKey={streamKey}
        displayName={displayName}
        startStream={startStream}
        onBack={() => dispatch({ type: "CLOSE_LOGS" })}
      />
    );
  }

  const isDockerError =
    state.error &&
    (state.error.includes("Docker not available") ||
      state.error.includes("command not found") ||
      state.error.includes("connect: no such file") ||
      state.error.includes("client error (Connect)"));

  if (isDockerError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-[260px] space-y-2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-(--t-bg-card) text-(--t-text-muted) border border-(--t-border)">
            <Icon icon="mdi:docker" width={22} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-(--t-text)">Docker is not reachable</h3>
            <p className="mt-1 text-[11px] leading-4 text-(--t-text-muted)">
              Start Docker in this environment, then refresh.
            </p>
          </div>
          <button
            onClick={() => fetchForView(state.view)}
            disabled={state.loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--t-border) px-2.5 py-1 text-[11px] text-(--t-text-muted) hover:bg-(--t-bg-hover) hover:text-(--t-text) disabled:opacity-40"
          >
            <Icon icon="lucide:refresh-cw" width={12} className={state.loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const selectStack = async (stackName: string) => {
    dispatch({ type: "SELECT_STACK", stackName });
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const services = await dockerListStackServices(sessionId, isRemote, localShell, stackName);
      dispatch({ type: "SET_STACK_SERVICES", services });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: String(e) });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar + actions */}
      <div className="flex items-center border-b border-(--t-border) shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => dispatch({ type: "SET_VIEW", view: tab.id })}
            title={tab.label}
            className={`flex-1 flex items-center justify-center py-1.5 text-[10px] gap-1 border-b-2 transition-colors ${
              state.view === tab.id
                ? "border-(--t-accent) text-(--t-text)"
                : "border-transparent text-(--t-text-muted) hover:text-(--t-text)"
            }`}
          >
            <Icon icon={tab.icon} width={12} />
          </button>
        ))}
        <div className="flex items-center gap-0.5 px-1.5 border-l border-(--t-border)">
          <button
            onClick={() => fetchForView(state.view)}
            disabled={state.loading}
            title="Refresh"
            className="p-1 text-(--t-text-muted) hover:text-(--t-text) disabled:opacity-40"
          >
            <Icon icon="lucide:refresh-cw" width={11} className={state.loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={async () => {
              setSysPruning(true);
              setSysPruneMsg(null);
              try {
                const msg = await dockerSystemPrune(sessionId, isRemote, localShell);
                setSysPruneMsg(msg);
                fetchForView(state.view);
              } catch (e) {
                setSysPruneMsg(String(e));
              } finally {
                setSysPruning(false);
              }
            }}
            disabled={sysPruning}
            title="System prune (docker system prune -a)"
            className="p-1 text-(--t-status-warning) opacity-70 hover:opacity-100 disabled:opacity-40"
          >
            <Icon icon="lucide:flame" width={11} />
          </button>
        </div>
      </div>

      {sysPruneMsg && (
        <p className="px-3 py-1 text-[10px] text-(--t-text-muted) border-b border-(--t-border) shrink-0">
          {sysPruneMsg}
        </p>
      )}

      {/* Error state */}
      {state.error && (
        <div className="px-3 py-2 text-[10px] text-(--t-text-muted)">
          <p className="break-all">{state.error}</p>
        </div>
      )}

      {/* Content */}
      {!state.error && (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {state.view === "containers" && (
            <ContainerList
              containers={state.containers}
              showStopped={state.showStopped}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onLogs={(id, name) => {
                logsContainerNameRef.current = name;
                dispatch({ type: "OPEN_LOGS", containerId: id, containerName: name });
              }}
              onTerminal={handleOpenTerminal}
              onRefresh={() => fetchForView("containers")}
              onToggleStopped={() => dispatch({ type: "TOGGLE_STOPPED" })}
            />
          )}
          {state.view === "images" && (
            <ImageList
              images={state.images}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onRefresh={() => fetchForView("images")}
            />
          )}
          {state.view === "volumes" && (
            <VolumeList
              volumes={state.volumes}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onRefresh={() => fetchForView("volumes")}
            />
          )}
          {state.view === "networks" && (
            <NetworkList
              networks={state.networks}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onRefresh={() => fetchForView("networks")}
            />
          )}
          {state.view === "stacks" && (
            <StackList
              stacks={state.stacks}
              services={state.stackServices}
              selectedStackName={state.selectedStackName}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onSelectStack={selectStack}
              onLogs={(id, name) => {
                logsContainerNameRef.current = name;
                dispatch({ type: "OPEN_LOGS", containerId: id, containerName: name });
              }}
              onStackLogs={(name) => dispatch({ type: "OPEN_STACK_LOGS", stackName: name })}
              onTerminal={handleOpenTerminal}
              onRefresh={() => fetchForView("stacks")}
            />
          )}
        </div>
      )}
    </div>
  );
}
