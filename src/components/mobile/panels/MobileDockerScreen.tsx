import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useDockerList } from "@/plugins/docker/useDockerList";
import type { ContainerAction, DockerContainer } from "@/plugins/docker/types";
import MobilePanelHeader from "./MobilePanelHeader";
import BottomSheet from "../sheets/BottomSheet";

/** State dot colour: running = green, paused = amber, otherwise dim. */
function stateColor(state: string): string {
  if (state === "running") return "var(--t-status-connected)";
  if (state === "paused") return "var(--t-status-warning)";
  return "var(--t-text-dim)";
}

/** Compact "8080:80, 443:443/udp" summary from the container's published ports. */
function portsSummary(ports: DockerContainer["ports"]): string {
  const parts = ports
    .filter((p) => p.host_port != null)
    .map((p) => {
      const proto = p.protocol && p.protocol !== "tcp" ? `/${p.protocol}` : "";
      return `${p.host_port}:${p.container_port}${proto}`;
    });
  return parts.join(", ");
}

function containerName(c: DockerContainer): string {
  return c.names[0] ?? c.id.slice(0, 12);
}

interface ActionItem {
  action: ContainerAction;
  label: string;
  icon: string;
  danger?: boolean;
}

/** Actions offered for a container depending on its state. */
function actionsFor(state: string): ActionItem[] {
  const items: ActionItem[] = [];
  if (state === "running") {
    items.push(
      { action: "stop", label: "Stop", icon: "lucide:square" },
      { action: "restart", label: "Restart", icon: "lucide:rotate-cw" },
      { action: "pause", label: "Pause", icon: "lucide:pause" },
    );
  } else if (state === "paused") {
    items.push(
      { action: "unpause", label: "Resume", icon: "lucide:play" },
      { action: "stop", label: "Stop", icon: "lucide:square" },
    );
  } else {
    items.push({ action: "start", label: "Start", icon: "lucide:play" });
  }
  return items;
}

export default function MobileDockerScreen({ sessionId }: { sessionId: string }) {
  // `.find` returns a stable element ref (or undefined) — safe selector, no fresh array.
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  const push = useMobileNavStore((s) => s.push);

  const { containers, loading, error, dockerUnreachable, refresh, act, openExecTerminal } = useDockerList(session);

  const [showAll, setShowAll] = useState(false);
  const [sheetFor, setSheetFor] = useState<DockerContainer | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<DockerContainer | null>(null);

  // Only SSH docker is supported on mobile; gate streaming/actions on a live SSH session.
  const ready = session?.type === "ssh" && session.status === "connected";

  const visible = useMemo(
    () => (showAll ? containers : containers.filter((c) => c.state === "running" || c.state === "paused")),
    [containers, showAll],
  );

  const runAction = async (c: DockerContainer, action: ContainerAction) => {
    setSheetFor(null);
    try {
      await act(c.id, action);
    } catch (e) {
      console.error("[docker] action failed:", e);
    }
  };

  const header = (
    <MobilePanelHeader
      title="Docker"
      sessionName={session?.connectionName}
      right={
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-xs px-2 py-1 rounded-lg"
            style={{
              background: showAll ? "var(--t-bg-card)" : "transparent",
              color: showAll ? "var(--t-text-primary)" : "var(--t-text-dim)",
            }}
          >
            {showAll ? "All" : "Running"}
          </button>
          <button onClick={() => void refresh()} disabled={loading} className="p-2 text-(--t-text-dim) disabled:opacity-40">
            <Icon icon="lucide:refresh-cw" width={18} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      }
    />
  );

  let body: React.ReactNode;
  if (!session || session.type !== "ssh") {
    body = (
      <Empty icon="mdi:docker" title="Docker needs an SSH session" sub="Open Docker from a host connected over SSH." />
    );
  } else if (session.status !== "connected") {
    body = <Empty icon="mdi:docker" title="Session not connected" sub="Reconnect to manage this host's Docker." />;
  } else if (dockerUnreachable) {
    body = (
      <Empty icon="mdi:docker" title="Docker is not reachable" sub="Start Docker on the host, then refresh." action={{ label: "Refresh", onClick: () => void refresh() }} />
    );
  } else if (error) {
    body = (
      <div className="px-4 py-4 text-xs text-(--t-text-dim) break-all">{error}</div>
    );
  } else if (visible.length === 0) {
    body = (
      <Empty
        icon="lucide:box"
        title={containers.length === 0 ? "No containers" : "No running containers"}
        sub={containers.length === 0 ? undefined : "Tap Running to show all."}
      />
    );
  } else {
    body = (
      <div className="flex-1 overflow-y-auto">
        {visible.map((c) => {
          const ports = portsSummary(c.ports);
          return (
            <button
              key={c.id}
              data-mobile-docker-container={c.id}
              onClick={() => ready && setSheetFor(c)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card) min-w-0"
            >
              <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: stateColor(c.state) }} />
              <span className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium text-(--t-text-primary) truncate">{containerName(c)}</span>
                <span className="text-xs text-(--t-text-dim) truncate">{c.image}</span>
                {ports && <span className="text-[11px] font-mono text-(--t-text-dim) truncate">{ports}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-(--t-text-dim) truncate max-w-[40%]">{c.status}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      {header}
      {body}

      {sheetFor && (
        <BottomSheet title={containerName(sheetFor)} onClose={() => setSheetFor(null)}>
          <div className="flex flex-col">
            {actionsFor(sheetFor.state).map((it) => (
              <SheetRow
                key={it.action}
                icon={it.icon}
                label={it.label}
                onClick={() => void runAction(sheetFor, it.action)}
              />
            ))}
            <SheetRow
              icon="lucide:scroll-text"
              label="Logs"
              onClick={() => {
                const c = sheetFor;
                setSheetFor(null);
                push({ kind: "panel-docker-logs", sessionId, containerId: c.id, containerName: containerName(c) });
              }}
            />
            <SheetRow
              icon="lucide:terminal"
              label="Exec shell"
              onClick={() => {
                const c = sheetFor;
                setSheetFor(null);
                void openExecTerminal(c.id, containerName(c));
              }}
            />
            <SheetRow
              icon="lucide:trash-2"
              label="Remove"
              danger
              onClick={() => {
                setConfirmRemove(sheetFor);
                setSheetFor(null);
              }}
            />
          </div>
        </BottomSheet>
      )}

      {confirmRemove && (
        <BottomSheet title="Remove container?" onClose={() => setConfirmRemove(null)}>
          <div className="flex flex-col gap-3 px-2 py-1">
            <p className="text-xs text-(--t-text-dim)">
              {containerName(confirmRemove)} will be removed. This can't be undone.
            </p>
            <button
              data-mobile-docker-remove-confirm
              onClick={() => {
                const c = confirmRemove;
                setConfirmRemove(null);
                void runAction(c, "remove");
              }}
              className="w-full rounded-xl py-3 text-sm font-medium"
              style={{ background: "var(--t-status-error)", color: "#fff" }}
            >
              Remove
            </button>
            <button
              onClick={() => setConfirmRemove(null)}
              className="w-full rounded-xl py-3 text-sm text-(--t-text-primary)"
              style={{ background: "var(--t-bg-card)" }}
            >
              Cancel
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function SheetRow({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      data-mobile-docker-action={label}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 text-left active:bg-(--t-bg-card)"
      style={{ color: danger ? "var(--t-status-error)" : "var(--t-text-primary)" }}
    >
      <Icon icon={icon} width={18} />
      <span className="text-sm">{label}</span>
    </button>
  );
}

function Empty({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-2 text-(--t-text-dim)">
      <Icon icon={icon} width={32} />
      <span className="text-sm text-(--t-text-primary)">{title}</span>
      {sub && <span className="text-xs">{sub}</span>}
      {action && (
        <button onClick={action.onClick} className="mt-2 text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--t-bg-card)", color: "var(--t-text-primary)" }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
