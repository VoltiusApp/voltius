import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { ContainerRow } from "./ContainerRow";
import type { DockerContainer } from "../types";
import { checkableImage, useImageUpdates } from "../useImageUpdates";

interface Props {
  containers: DockerContainer[];
  showStopped: boolean;
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onLogs: (id: string, name: string) => void;
  onTerminal: (id: string, name: string) => void;
  onRefresh: () => void;
  onToggleStopped: () => void;
}

export function ContainerList({
  containers,
  showStopped,
  sessionId,
  isRemote,
  localShell,
  onLogs,
  onTerminal,
  onRefresh,
  onToggleStopped,
}: Props) {
  const visible = showStopped
    ? containers
    : containers.filter((c) => c.state === "running" || c.state === "paused");

  const imageRefs = useMemo(() => containers.map((c) => c.image), [containers]);
  const { statuses, checking, settings, runChecks, checkAll } = useImageUpdates({
    images: imageRefs,
    sessionId,
    isRemote,
    localShell,
  });
  const isChecking = checking.size > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-(--t-border) shrink-0">
        <span className="text-[10px] text-(--t-text-muted)">
          {containers.filter((c) => c.state === "running").length} running
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={checkAll}
            disabled={isChecking}
            title="Check containers for image updates"
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm text-(--t-text-muted) hover:bg-(--t-bg-hover) hover:text-(--t-text) disabled:opacity-40"
          >
            <Icon icon="lucide:arrow-up-circle" width={10} className={isChecking ? "animate-pulse" : ""} />
            {isChecking ? "checking…" : "updates"}
          </button>
          <button
            onClick={onToggleStopped}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              showStopped
                ? "bg-(--t-bg-hover) text-(--t-text)"
                : "text-(--t-text-muted) hover:bg-(--t-bg-hover)"
            }`}
          >
            all
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-20 opacity-40">
            <p className="text-[11px] text-(--t-text-muted)">
              {containers.length === 0 ? "No containers" : "No running containers"}
            </p>
          </div>
        ) : (
          visible.map((c) => {
            const tag = checkableImage(c.image);
            return (
              <ContainerRow
                key={c.id}
                container={c}
                sessionId={sessionId}
                isRemote={isRemote}
                localShell={localShell}
                status={tag ? statuses[tag] : undefined}
                checking={tag ? checking.has(tag) : false}
                recreateAfterPull={settings?.recreateAfterPull ?? true}
                onLogs={onLogs}
                onTerminal={onTerminal}
                onRefresh={onRefresh}
                onUpdated={() => tag && runChecks([tag], true)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
