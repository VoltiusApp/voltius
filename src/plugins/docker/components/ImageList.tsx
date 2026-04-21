import { useState } from "react";
import { Icon } from "@iconify/react";
import { dockerPruneImages, dockerRemoveImage } from "../services";
import type { DockerImage } from "../types";

function fmtSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtAge(ts: number): string {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface Props {
  images: DockerImage[];
  sessionId: string;
  isRemote: boolean;
  onRefresh: () => void;
}

export function ImageList({ images, sessionId, isRemote, onRefresh }: Props) {
  const [pruning, setPruning] = useState(false);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);

  const prune = async () => {
    setPruning(true);
    setPruneMsg(null);
    try {
      const msg = await dockerPruneImages(sessionId, isRemote);
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
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--t-border)] shrink-0">
        <span className="text-[10px] text-[var(--t-text-muted)]">{images.length} images</span>
        <button
          onClick={prune}
          disabled={pruning}
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-[var(--t-status-warning)] hover:bg-[var(--t-bg-hover)] disabled:opacity-40"
        >
          <Icon icon="lucide:trash" width={10} />
          {pruning ? "pruning…" : "prune"}
        </button>
      </div>

      {pruneMsg && (
        <p className="px-3 py-1 text-[10px] text-[var(--t-text-muted)] border-b border-[var(--t-border)]">
          {pruneMsg}
        </p>
      )}

      <div className="overflow-y-auto flex-1">
        {images.length === 0 ? (
          <div className="flex items-center justify-center h-20 opacity-40">
            <p className="text-[11px] text-[var(--t-text-muted)]">No images</p>
          </div>
        ) : (
          images.map((img) => (
            <ImageRow
              key={img.id}
              img={img}
              sessionId={sessionId}
              isRemote={isRemote}
              onRefresh={onRefresh}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ImageRow({
  img,
  sessionId,
  isRemote,
  onRefresh,
}: {
  img: DockerImage;
  sessionId: string;
  isRemote: boolean;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const tag = img.repo_tags[0] ?? "<none>";
  const [repo, ver] = tag.includes(":") ? tag.split(":") : [tag, ""];

  const remove = async () => {
    setBusy(true);
    try {
      await dockerRemoveImage(sessionId, isRemote, img.id);
      onRefresh();
    } catch (e) {
      console.error("[docker] remove image failed:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--t-border)] last:border-0 hover:bg-[var(--t-bg-hover)] group">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[var(--t-text)] truncate">{repo}</p>
        <p className="text-[10px] text-[var(--t-text-muted)] font-mono">{ver || "latest"}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-[var(--t-text-muted)]">{fmtSize(img.size)}</p>
        <p className="text-[10px] text-[var(--t-text-muted)]">{fmtAge(img.created)}</p>
      </div>
      <button
        disabled={busy}
        onClick={remove}
        title="Remove image"
        className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--t-status-error)] opacity-60 hover:opacity-100 disabled:opacity-40 shrink-0"
      >
        <Icon icon="lucide:trash-2" width={11} />
      </button>
    </div>
  );
}
