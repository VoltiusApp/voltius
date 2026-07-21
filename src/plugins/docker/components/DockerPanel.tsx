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
import { matchContainer, matchImage, matchVolume, matchNetwork, matchStack } from "../filter";

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
  | { type: "SET_FILTER"; view: ListView; query: string }
  | { type: "OPEN_SEARCH" }
  | { type: "CLOSE_SEARCH" }
  | { type: "RESET" };

type ListView = Exclude<DockerView, "logs">;

const EMPTY_FILTERS: Record<ListView, string> = {
  containers: "",
  images: "",
  volumes: "",
  networks: "",
  stacks: "",
};

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
  filters: { ...EMPTY_FILTERS },
  searchOpen: false,
};

function reducer(state: DockerState, action: Action): DockerState {
  switch (action.type) {
    case "SET_VIEW": {
      const nextOpen =
        action.view === "logs"
          ? state.searchOpen
          : state.searchOpen || state.filters[action.view].length > 0;
      return { ...state, view: action.view, error: null, searchOpen: nextOpen };
    }
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
    case "SET_FILTER":
      return { ...state, filters: { ...state.filters, [action.view]: action.query } };
    case "OPEN_SEARCH":
      return { ...state, searchOpen: true };
    case "CLOSE_SEARCH": {
      if (state.view === "logs") return { ...state, searchOpen: false };
      return { ...state, searchOpen: false, filters: { ...state.filters, [state.view]: "" } };
    }
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  // fetchForView is memoized without selectedStackName in its deps, so the
  // polling interval's closure would otherwise read a stale value and never
  // refetch the expanded stack's services. A ref keeps it current.
  const selectedStackNameRef = useRef(state.selectedStackName);
  selectedStackNameRef.current = state.selectedStackName;

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
            const selectedStackName = selectedStackNameRef.current;
            if (selectedStackName) {
              const services = await dockerListStackServices(sessionId, isRemote, localShell, selectedStackName);
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

  useEffect(() => {
    if (state.searchOpen) searchInputRef.current?.focus();
  }, [state.searchOpen]);

  useEffect(() => {
    const open = () => { dispatch({ type: "OPEN_SEARCH" }); searchInputRef.current?.focus(); searchInputRef.current?.select(); };
    window.addEventListener("voltius:focus-panel-search", open);
    return () => window.removeEventListener("voltius:focus-panel-search", open);
  }, []);

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

  const activeQuery = state.view === "logs" ? "" : state.filters[state.view];
  const filteredContainers = state.containers.filter((c) => matchContainer(c, activeQuery));
  const filteredImages = state.images.filter((i) => matchImage(i, activeQuery));
  const filteredVolumes = state.volumes.filter((v) => matchVolume(v, activeQuery));
  const filteredNetworks = state.networks.filter((n) => matchNetwork(n, activeQuery));
  const filteredStacks = state.stacks.filter((s) => matchStack(s, activeQuery));

  const filterCounts: Record<ListView, { shown: number; total: number }> = {
    containers: { shown: filteredContainers.length, total: state.containers.length },
    images: { shown: filteredImages.length, total: state.images.length },
    volumes: { shown: filteredVolumes.length, total: state.volumes.length },
    networks: { shown: filteredNetworks.length, total: state.networks.length },
    stacks: { shown: filteredStacks.length, total: state.stacks.length },
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
            onClick={() => dispatch({ type: state.searchOpen ? "CLOSE_SEARCH" : "OPEN_SEARCH" })}
            title="Search"
            className="relative p-1 text-(--t-text-muted) hover:text-(--t-text)"
            style={{ color: state.searchOpen ? "var(--t-accent)" : undefined }}
          >
            <Icon icon="lucide:search" width={11} />
            {state.view !== "logs" && state.filters[state.view].length > 0 && (
              <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-(--t-accent)" />
            )}
          </button>
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

      {state.searchOpen && state.view !== "logs" && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-(--t-border) shrink-0">
          <Icon icon="lucide:search" width={12} className="text-(--t-text-muted) shrink-0" />
          <input
            ref={searchInputRef}
            value={state.filters[state.view]}
            onChange={(e) => dispatch({ type: "SET_FILTER", view: state.view as ListView, query: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); dispatch({ type: "CLOSE_SEARCH" }); } }}
            placeholder="Filter…"
            className="flex-1 bg-transparent text-[11px] text-(--t-text-primary) placeholder:text-(--t-text-dim) outline-hidden"
          />
          <span className="text-[10px] text-(--t-text-dim) shrink-0 tabular-nums">
            {filterCounts[state.view as ListView].shown}/{filterCounts[state.view as ListView].total}
          </span>
          <button
            onClick={() => dispatch({ type: "CLOSE_SEARCH" })}
            title="Close search"
            className="p-0.5 text-(--t-text-muted) hover:text-(--t-text)"
          >
            <Icon icon="lucide:x" width={11} />
          </button>
        </div>
      )}

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
              containers={filteredContainers}
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
              images={filteredImages}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onRefresh={() => fetchForView("images")}
            />
          )}
          {state.view === "volumes" && (
            <VolumeList
              volumes={filteredVolumes}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onRefresh={() => fetchForView("volumes")}
            />
          )}
          {state.view === "networks" && (
            <NetworkList
              networks={filteredNetworks}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onRefresh={() => fetchForView("networks")}
            />
          )}
          {state.view === "stacks" && (
            <StackList
              stacks={filteredStacks}
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
