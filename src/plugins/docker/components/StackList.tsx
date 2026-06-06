import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { dockerContainerAction, dockerStackAction, dockerStackUpdate } from "../services";
import { getDockerApi } from "../runtime";
import { checkableImage, useImageUpdates } from "../useImageUpdates";
import type {
  ContainerAction,
  DockerStack,
  DockerStackService,
  ImageUpdateStatus,
  PortMapping,
  StackAction,
} from "../types";
import { UpdateBadge } from "./UpdateBadge";

interface Props {
  stacks: DockerStack[];
  services: DockerStackService[];
  selectedStackName: string | null;
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onSelectStack: (name: string) => void;
  onLogs: (id: string, name: string) => void;
  onStackLogs: (name: string) => void;
  onTerminal: (id: string, name: string) => void;
  onRefresh: () => void;
}

function fmtPorts(ports: PortMapping[]): string {
  if (ports.length === 0) return "";
  return ports
    .map((p) => {
      const target = `${p.container_port}/${p.protocol}`;
      return p.host_port ? `${p.host_port}->${target}` : target;
    })
    .join(", ");
}

export function StackList({
  stacks,
  services,
  selectedStackName,
  sessionId,
  isRemote,
  localShell,
  onSelectStack,
  onLogs,
  onStackLogs,
  onTerminal,
  onRefresh,
}: Props) {
  const [expandedStackName, setExpandedStackName] = useState<string | null>(selectedStackName);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const imageRefs = useMemo(() => services.map((s) => s.image), [services]);
  const { statuses, checking, checkAll } = useImageUpdates({
    images: imageRefs,
    sessionId,
    isRemote,
    localShell,
  });
  const isChecking = checking.size > 0;

  const updateStack = async (stackName: string) => {
    const key = `${stackName}:update`;
    setBusyAction(key);
    try {
      await dockerStackUpdate(sessionId, isRemote, localShell, stackName);
      getDockerApi()?.notifications.toast(`Updated stack ${stackName}`, { severity: "success" });
      onRefresh();
      checkAll();
    } catch (e) {
      getDockerApi()?.notifications.toast(`Stack update failed: ${e}`, { severity: "error" });
    } finally {
      setBusyAction(null);
    }
  };

  const toggleStack = (stackName: string) => {
    if (expandedStackName === stackName) {
      setExpandedStackName(null);
      return;
    }

    setExpandedStackName(stackName);
    onSelectStack(stackName);
  };

  const runAction = async (stackName: string, action: StackAction) => {
    const key = `${stackName}:${action}`;
    setBusyAction(key);
    try {
      await dockerStackAction(sessionId, isRemote, localShell, stackName, action);
      onRefresh();
    } catch (e) {
      console.error(`[docker] stack ${action} failed:`, e);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1 border-b border-(--t-border) shrink-0">
        <span className="text-[10px] text-(--t-text-muted)">{stacks.length} stacks</span>
        <button
          onClick={checkAll}
          disabled={isChecking || services.length === 0}
          title="Check the expanded stack's services for image updates"
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm text-(--t-text-muted) hover:bg-(--t-bg-hover) hover:text-(--t-text) disabled:opacity-40"
        >
          <Icon icon="lucide:arrow-up-circle" width={10} className={isChecking ? "animate-pulse" : ""} />
          {isChecking ? "checking…" : "updates"}
        </button>
      </div>

      {stacks.length === 0 ? (
        <div className="flex items-center justify-center h-20 opacity-40">
          <p className="text-[11px] text-(--t-text-muted)">No Compose stacks</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {stacks.map((stack) => {
            const expanded = expandedStackName === stack.name;
            const stackServices = selectedStackName === stack.name ? services : [];

            return (
              <div key={stack.name} className="border-b border-(--t-border) last:border-0">
                <div
                  onClick={() => toggleStack(stack.name)}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-(--t-bg-card-hover) cursor-pointer select-none"
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      stack.running > 0
                        ? "bg-(--t-status-connected)"
                        : stack.paused > 0
                          ? "bg-(--t-status-warning)"
                          : "bg-(--t-text-muted) opacity-40"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-(--t-text) truncate font-medium">{stack.name}</p>
                    <p className="text-[10px] text-(--t-text-muted) truncate">
                      {stack.status || `${stack.running}/${stack.total} running`}
                    </p>
                  </div>
                  <span className="text-[10px] text-(--t-text-muted) font-mono shrink-0">
                    {stack.running}/{stack.total}
                  </span>
                  <Icon
                    icon={expanded ? "lucide:chevron-up" : "lucide:chevron-down"}
                    width={12}
                    className="text-(--t-text-muted) shrink-0"
                  />
                </div>

                <div className="flex items-center gap-0.5 px-3 pb-1.5">
                  {stack.running < stack.total && (
                    <Btn
                      icon="lucide:play"
                      title="Up"
                      disabled={busyAction !== null}
                      onClick={() => runAction(stack.name, "up")}
                      busy={busyAction === `${stack.name}:up`}
                      color="text-(--t-status-connected)"
                    />
                  )}
                  {(stack.running > 0 || stack.paused > 0) && (
                    <Btn
                      icon="lucide:square"
                      title="Stop"
                      disabled={busyAction !== null}
                      onClick={() => runAction(stack.name, "stop")}
                      busy={busyAction === `${stack.name}:stop`}
                    />
                  )}
                  <Btn
                    icon="lucide:rotate-ccw"
                    title="Restart"
                    disabled={busyAction !== null}
                    onClick={() => runAction(stack.name, "restart")}
                    busy={busyAction === `${stack.name}:restart`}
                  />
                  <Btn
                    icon="lucide:arrow-up-circle"
                    title="Update stack (compose pull + up -d)"
                    disabled={busyAction !== null}
                    onClick={() => updateStack(stack.name)}
                    busy={busyAction === `${stack.name}:update`}
                    color="text-(--t-status-warning) hover:text-(--t-status-warning)"
                  />
                  <Btn
                    icon="lucide:scroll-text"
                    title="Compose logs"
                    disabled={busyAction !== null}
                    onClick={() => onStackLogs(stack.name)}
                    busy={false}
                  />
                  <Btn
                    icon="lucide:arrow-big-down"
                    title="Down"
                    disabled={busyAction !== null}
                    onClick={() => runAction(stack.name, "down")}
                    busy={busyAction === `${stack.name}:down`}
                    color="text-(--t-status-error) opacity-60 hover:opacity-100"
                  />
                </div>

                {expanded && (
                  <div className="px-3 pb-2 space-y-1">
                    {stack.config_files.length > 0 && (
                      <p className="text-[10px] text-(--t-text-muted) truncate font-mono">
                        {stack.config_files.join(", ")}
                      </p>
                    )}
                    {stackServices.length === 0 ? (
                      <p className="text-[10px] text-(--t-text-muted) opacity-60">No services</p>
                    ) : (
                      <div className="rounded-md border border-(--t-border) overflow-hidden">
                        {stackServices.map((service) => {
                          const tag = checkableImage(service.image);
                          return (
                            <ServiceRow
                              key={service.id || service.name}
                              service={service}
                              sessionId={sessionId}
                              isRemote={isRemote}
                              localShell={localShell}
                              status={tag ? statuses[tag] : undefined}
                              checking={tag ? checking.has(tag) : false}
                              onLogs={onLogs}
                              onTerminal={onTerminal}
                              onRefresh={onRefresh}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ServiceRow({
  service,
  sessionId,
  isRemote,
  localShell,
  status,
  checking = false,
  onLogs,
  onTerminal,
  onRefresh,
}: {
  service: DockerStackService;
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  status?: ImageUpdateStatus;
  checking?: boolean;
  onLogs: (id: string, name: string) => void;
  onTerminal: (id: string, name: string) => void;
  onRefresh: () => void;
}) {
  const [busyAction, setBusyAction] = useState<ContainerAction | null>(null);

  const runAction = async (action: ContainerAction) => {
    if (!service.id) return;
    setBusyAction(action);
    try {
      await dockerContainerAction(sessionId, isRemote, localShell, service.id, action);
      onRefresh();
    } catch (e) {
      console.error(`[docker] container ${action} failed:`, e);
    } finally {
      setBusyAction(null);
    }
  };

  const busy = busyAction !== null;
  const { state } = service;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-(--t-border) last:border-0 hover:bg-(--t-bg-card-hover) group">
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          state === "running"
            ? "bg-(--t-status-connected)"
            : state === "paused"
              ? "bg-(--t-status-warning)"
              : "bg-(--t-text-muted) opacity-40"
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-(--t-text) truncate">{service.service || service.name}</p>
        <p className="text-[10px] text-(--t-text-muted) truncate">{service.status || state}</p>
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[10px] text-(--t-text-muted) truncate font-mono">{service.image}</p>
          <UpdateBadge status={status} checking={checking} />
        </div>
        {service.ports.length > 0 && (
          <p className="text-[10px] text-(--t-text-muted) truncate font-mono">{fmtPorts(service.ports)}</p>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {state === "running" && (
          <>
            <Btn icon="lucide:square" title="Stop" disabled={busy || !service.id} busy={busyAction === "stop"} onClick={() => runAction("stop")} />
            <Btn icon="lucide:rotate-ccw" title="Restart" disabled={busy || !service.id} busy={busyAction === "restart"} onClick={() => runAction("restart")} />
            <Btn icon="lucide:pause" title="Pause" disabled={busy || !service.id} busy={busyAction === "pause"} onClick={() => runAction("pause")} />
          </>
        )}
        {state === "paused" && (
          <Btn icon="lucide:play" title="Unpause" disabled={busy || !service.id} busy={busyAction === "unpause"} onClick={() => runAction("unpause")} color="text-(--t-status-connected)" />
        )}
        {state !== "running" && state !== "paused" && (
          <Btn icon="lucide:play" title="Start" disabled={busy || !service.id} busy={busyAction === "start"} onClick={() => runAction("start")} color="text-(--t-status-connected)" />
        )}
        <button
          disabled={!service.id}
          onClick={() => onLogs(service.id, service.name || service.service)}
          title="Logs"
          className="p-1 rounded-sm text-(--t-text-muted) hover:bg-(--t-bg-card-hover) hover:text-(--t-text) disabled:opacity-30"
        >
          <Icon icon="lucide:scroll-text" width={12} />
        </button>
        {state === "running" && (
          <button
            disabled={!service.id}
            onClick={() => onTerminal(service.id, service.name || service.service)}
            title="Open terminal"
            className="p-1 rounded-sm text-(--t-accent) opacity-80 hover:opacity-100 hover:bg-(--t-bg-card-hover) disabled:opacity-30"
          >
            <Icon icon="lucide:terminal" width={12} />
          </button>
        )}
        <Btn
          icon="lucide:arrow-big-down"
          title="Down"
          disabled={busy || !service.id}
          busy={busyAction === "remove"}
          onClick={() => runAction("remove")}
          color="text-(--t-status-error) opacity-60 hover:opacity-100"
        />
      </div>
    </div>
  );
}

function Btn({
  icon,
  title,
  disabled,
  busy,
  onClick,
  color = "text-(--t-text-muted) hover:text-(--t-text)",
}: {
  icon: string;
  title: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`p-1 rounded-sm hover:bg-(--t-bg-card-hover) disabled:opacity-40 ${color}`}
    >
      <Icon icon={busy ? "lucide:loader-2" : icon} width={12} className={busy ? "animate-spin" : ""} />
    </button>
  );
}
