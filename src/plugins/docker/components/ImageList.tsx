import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { dockerPruneImages, dockerRemoveImage } from "../services";
import type { DockerImage, ImageUpdateStatus } from "../types";
import { getDockerApi } from "../runtime";
import { checkableImage, useImageUpdates } from "../useImageUpdates";
import { pullAndMaybeRecreate } from "../updateActions";
import { UpdateBadge } from "./UpdateBadge";

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
  localShell: string | null;
  onRefresh: () => void;
}

export function ImageList({ images, sessionId, isRemote, localShell, onRefresh }: Props) {
  const [pruning, setPruning] = useState(false);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);

  const imageRefs = useMemo(() => images.map((i) => i.repo_tags[0] ?? ""), [images]);
  const { statuses, checking, settings, runChecks, checkAll } = useImageUpdates({
    images: imageRefs,
    sessionId,
    isRemote,
    localShell,
  });

  const onUpdated = (tag: string) => {
    onRefresh();
    void runChecks([tag], true);
  };

  const prune = async () => {
    setPruning(true);
    setPruneMsg(null);
    try {
      const msg = await dockerPruneImages(sessionId, isRemote, localShell);
      setPruneMsg(msg);
      onRefresh();
    } catch (e) {
      setPruneMsg(String(e));
    } finally {
      setPruning(false);
    }
  };

  const outdatedCount = useMemo(
    () => images.filter((i) => statuses[checkableImage(i.repo_tags[0]) ?? ""]?.status === "outdated").length,
    [images, statuses],
  );
  const isChecking = checking.size > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-(--t-border) shrink-0">
        <span className="text-[10px] text-(--t-text-muted)">
          {images.length} images
          {outdatedCount > 0 && (
            <span className="ml-1.5 text-(--t-status-warning)">· {outdatedCount} outdated</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={checkAll}
            disabled={isChecking}
            title="Check all images for registry updates"
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm text-(--t-text-muted) hover:bg-(--t-bg-hover) hover:text-(--t-text) disabled:opacity-40"
          >
            <Icon icon="lucide:arrow-up-circle" width={10} className={isChecking ? "animate-pulse" : ""} />
            {isChecking ? "checking…" : "check updates"}
          </button>
          <button
            onClick={prune}
            disabled={pruning}
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm text-(--t-status-warning) hover:bg-(--t-bg-hover) disabled:opacity-40"
          >
            <Icon icon="lucide:trash" width={10} />
            {pruning ? "pruning…" : "prune"}
          </button>
        </div>
      </div>

      {pruneMsg && (
        <p className="px-3 py-1 text-[10px] text-(--t-text-muted) border-b border-(--t-border)">
          {pruneMsg}
        </p>
      )}

      <div className="overflow-y-auto flex-1">
        {images.length === 0 ? (
          <div className="flex items-center justify-center h-20 opacity-40">
            <p className="text-[11px] text-(--t-text-muted)">No images</p>
          </div>
        ) : (
          images.map((img) => {
            const tag = checkableImage(img.repo_tags[0]);
            return (
              <ImageRow
                key={img.id}
                img={img}
                sessionId={sessionId}
                isRemote={isRemote}
                localShell={localShell}
                status={tag ? statuses[tag] : undefined}
                checking={tag ? checking.has(tag) : false}
                recreateAfterPull={settings?.recreateAfterPull ?? true}
                onRefresh={onRefresh}
                onUpdated={onUpdated}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function ImageRow({
  img,
  sessionId,
  isRemote,
  localShell,
  status,
  checking,
  recreateAfterPull,
  onRefresh,
  onUpdated,
}: {
  img: DockerImage;
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  status: ImageUpdateStatus | undefined;
  checking: boolean;
  recreateAfterPull: boolean;
  onRefresh: () => void;
  onUpdated: (tag: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const tag = img.repo_tags[0] ?? "<none>";
  const [repo, ver] = tag.includes(":") ? tag.split(":") : [tag, ""];

  const remove = async () => {
    setBusy(true);
    try {
      await dockerRemoveImage(sessionId, isRemote, localShell, img.id);
      onRefresh();
    } catch (e) {
      console.error("[docker] remove image failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const update = async () => {
    setPulling(true);
    try {
      await pullAndMaybeRecreate({ sessionId, isRemote, localShell, image: tag, recreate: recreateAfterPull });
      onUpdated(tag);
    } catch (e) {
      getDockerApi()?.notifications.toast(`Pull failed: ${e}`, { severity: "error" });
    } finally {
      setPulling(false);
    }
  };

  const outdated = status?.status === "outdated";

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-(--t-border) last:border-0 hover:bg-(--t-bg-hover) group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[11px] text-(--t-text) truncate">{repo}</p>
          <UpdateBadge status={status} checking={checking} />
        </div>
        <p className="text-[10px] text-(--t-text-muted) font-mono">{ver || "latest"}</p>
      </div>

      {outdated && (
        <button
          disabled={pulling}
          onClick={update}
          title={
            recreateAfterPull ? `Pull ${tag} and recreate its containers` : `Pull newer image for ${tag}`
          }
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--t-status-warning)_14%,transparent)] text-(--t-status-warning) hover:bg-[color-mix(in_srgb,var(--t-status-warning)_24%,transparent)] disabled:opacity-40 shrink-0"
        >
          <Icon
            icon={pulling ? "lucide:loader-circle" : "lucide:download"}
            width={10}
            className={pulling ? "animate-spin" : ""}
          />
          {pulling ? (recreateAfterPull ? "updating…" : "pulling…") : recreateAfterPull ? "update" : "pull"}
        </button>
      )}

      <div className="text-right shrink-0">
        <p className="text-[10px] text-(--t-text-muted)">{fmtSize(img.size)}</p>
        <p className="text-[10px] text-(--t-text-muted)">{fmtAge(img.created)}</p>
      </div>
      <button
        disabled={busy}
        onClick={remove}
        title="Remove image"
        className="opacity-0 group-hover:opacity-100 p-0.5 text-(--t-status-error) opacity-60 hover:opacity-100 disabled:opacity-40 shrink-0"
      >
        <Icon icon="lucide:trash-2" width={11} />
      </button>
    </div>
  );
}
