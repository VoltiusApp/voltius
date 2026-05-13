import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { localConnect, localSendInput } from "@/services/local";
import {
  dockerListContainers,
  dockerListImages,
  dockerListNetworks,
  dockerListVolumes,
  dockerSystemPrune,
} from "../services";
import type { DockerImage, DockerNetwork, DockerState, DockerView, DockerVolume } from "../types";
import { ContainerList } from "./ContainerList";
import { ImageList } from "./ImageList";
import { LogsView } from "./LogsView";
import { NetworkList } from "./NetworkList";
import { VolumeList } from "./VolumeList";
import type { DockerContainer } from "../types";

type Action =
  | { type: "SET_VIEW"; view: DockerView }
  | { type: "SET_CONTAINERS"; containers: DockerContainer[] }
  | { type: "SET_IMAGES"; images: DockerImage[] }
  | { type: "SET_VOLUMES"; volumes: DockerVolume[] }
  | { type: "SET_NETWORKS"; networks: DockerNetwork[] }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "OPEN_LOGS"; containerId: string; containerName: string }
  | { type: "CLOSE_LOGS" }
  | { type: "TOGGLE_STOPPED" }
  | { type: "RESET" };

const initial: DockerState = {
  view: "containers",
  containers: [],
  images: [],
  volumes: [],
  networks: [],
  logsContainerId: null,
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
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error, loading: false };
    case "OPEN_LOGS":
      return { ...state, view: "logs", logsContainerId: action.containerId, logLines: [] };
    case "CLOSE_LOGS":
      return { ...state, view: "containers", logsContainerId: null, logLines: [] };
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

  const handleOpenTerminal = useCallback(
    async (containerId: string, containerName: string) => {
      const newSessionId = crypto.randomUUID();

      if (isRemote) {
        // Open a new PTY channel on the existing SSH connection
        try {
          const execSessionId = await invoke<string>("docker_open_exec_session", {
            sourceSessionId: sessionId,
            containerId,
          });
          useSessionStore.setState((s) => ({
            sessions: [
              ...s.sessions,
              {
                id: execSessionId,
                connectionId: activeSession!.connectionId,
                connectionName: `exec: ${containerName}`,
                status: "connected" as const,
                type: "ssh" as const,
              },
            ],
            activeSessionId: execSessionId,
          }));
        } catch (e) {
          console.error("[docker] open exec session failed:", e);
          return;
        }
      } else {
        // Local: spawn a new local PTY running docker exec
        useSessionStore.setState((s) => ({
          sessions: [
            ...s.sessions,
            {
              id: newSessionId,
              connectionId: "local",
              connectionName: `exec: ${containerName}`,
              status: "connecting" as const,
              type: "local" as const,
              localShell: localShell ?? undefined,
            },
          ],
          activeSessionId: newSessionId,
        }));
        try {
          await localConnect(newSessionId, 80, 24, localShell ?? undefined);
          await localSendInput(newSessionId, new TextEncoder().encode(`docker exec -it ${containerId} sh\r`));
          useSessionStore.setState((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === newSessionId ? { ...sess, status: "connected" as const } : sess,
            ),
          }));
        } catch (e) {
          useSessionStore.setState((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === newSessionId ? { ...sess, status: "error" as const } : sess,
            ),
          }));
          return;
        }
      }

      useUIStore.getState().setActiveNav("terminal" as any);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, isRemote, activeSession?.connectionId, localShell],
  );

  const fetchForView = useCallback(
    async (view: DockerView) => {
      if (!activeSession || activeSession.status !== "connected") return;
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
        <p className="text-sm text-[var(--t-text-muted)]">No active session</p>
      </div>
    );
  }

  if (state.view === "logs" && state.logsContainerId) {
    return (
      <LogsView
        sessionId={sessionId}
        isRemote={isRemote}
        localShell={localShell}
        containerId={state.logsContainerId}
        containerName={logsContainerNameRef.current}
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
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--t-bg-card)] text-[var(--t-text-muted)] border border-[var(--t-border)]">
            <Icon icon="mdi:docker" width={22} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--t-text)]">Docker is not reachable</h3>
            <p className="mt-1 text-[11px] leading-4 text-[var(--t-text-muted)]">
              Start Docker in this environment, then refresh.
            </p>
          </div>
          <button
            onClick={() => fetchForView(state.view)}
            disabled={state.loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--t-border)] px-2.5 py-1 text-[11px] text-[var(--t-text-muted)] hover:bg-[var(--t-bg-hover)] hover:text-[var(--t-text)] disabled:opacity-40"
          >
            <Icon icon="lucide:refresh-cw" width={12} className={state.loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar + actions */}
      <div className="flex items-center border-b border-[var(--t-border)] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => dispatch({ type: "SET_VIEW", view: tab.id })}
            title={tab.label}
            className={`flex-1 flex items-center justify-center py-1.5 text-[10px] gap-1 border-b-2 transition-colors ${
              state.view === tab.id
                ? "border-[var(--t-accent)] text-[var(--t-text)]"
                : "border-transparent text-[var(--t-text-muted)] hover:text-[var(--t-text)]"
            }`}
          >
            <Icon icon={tab.icon} width={12} />
          </button>
        ))}
        <div className="flex items-center gap-0.5 px-1.5 border-l border-[var(--t-border)]">
          <button
            onClick={() => fetchForView(state.view)}
            disabled={state.loading}
            title="Refresh"
            className="p-1 text-[var(--t-text-muted)] hover:text-[var(--t-text)] disabled:opacity-40"
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
            className="p-1 text-[var(--t-status-warning)] opacity-70 hover:opacity-100 disabled:opacity-40"
          >
            <Icon icon="lucide:flame" width={11} />
          </button>
        </div>
      </div>

      {sysPruneMsg && (
        <p className="px-3 py-1 text-[10px] text-[var(--t-text-muted)] border-b border-[var(--t-border)] shrink-0">
          {sysPruneMsg}
        </p>
      )}

      {/* Error state */}
      {state.error && (
        <div className="px-3 py-2 text-[10px] text-[var(--t-text-muted)]">
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
        </div>
      )}
    </div>
  );
}
