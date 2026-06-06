import { useState } from "react";
import { Icon } from "@iconify/react";
import { dockerPruneVolumes, dockerRemoveVolume } from "../services";
import type { DockerVolume } from "../types";

interface Props {
  volumes: DockerVolume[];
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onRefresh: () => void;
}

export function VolumeList({ volumes, sessionId, isRemote, localShell, onRefresh }: Props) {
  const [pruning, setPruning] = useState(false);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);

  const prune = async () => {
    setPruning(true);
    setPruneMsg(null);
    try {
      const msg = await dockerPruneVolumes(sessionId, isRemote, localShell);
      setPruneMsg(msg);
      onRefresh();
    } catch (e) {
      setPruneMsg(String(e));
    } finally {
      setPruning(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1 border-b border-(--t-border) shrink-0">
        <span className="text-[10px] text-(--t-text-muted)">{volumes.length} volumes</span>
        <button
          onClick={prune}
          disabled={pruning}
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm text-(--t-status-warning) hover:bg-(--t-bg-hover) disabled:opacity-40"
        >
          <Icon icon="lucide:trash" width={10} />
          {pruning ? "pruning…" : "prune"}
        </button>
      </div>

      {pruneMsg && (
        <p className="px-3 py-1 text-[10px] text-(--t-text-muted) border-b border-(--t-border)">
          {pruneMsg}
        </p>
      )}

      <div className="overflow-y-auto flex-1">
        {volumes.length === 0 ? (
          <div className="flex items-center justify-center h-20 opacity-40">
            <p className="text-[11px] text-(--t-text-muted)">No volumes</p>
          </div>
        ) : (
          volumes.map((v) => (
            <VolumeRow
              key={v.name}
              volume={v}
              sessionId={sessionId}
              isRemote={isRemote}
              localShell={localShell}
              onRefresh={onRefresh}
            />
          ))
        )}
      </div>
    </div>
  );
}

function VolumeRow({
  volume,
  sessionId,
  isRemote,
  localShell,
  onRefresh,
}: {
  volume: DockerVolume;
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await dockerRemoveVolume(sessionId, isRemote, localShell, volume.name);
      onRefresh();
    } catch (e) {
      console.error("[docker] remove volume failed:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-(--t-border) last:border-0 hover:bg-(--t-bg-hover) group">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-(--t-text) truncate font-mono">{volume.name}</p>
        <p className="text-[10px] text-(--t-text-muted)">{volume.driver}</p>
      </div>
      <button
        disabled={busy}
        onClick={remove}
        title="Remove volume"
        className="opacity-0 group-hover:opacity-100 p-0.5 text-(--t-status-error) opacity-60 hover:opacity-100 disabled:opacity-40 shrink-0"
      >
        <Icon icon="lucide:trash-2" width={11} />
      </button>
    </div>
  );
}
