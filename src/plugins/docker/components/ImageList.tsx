import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { dockerPruneImages, dockerRemoveImage } from "../services";
import type { DockerImage, ImageUpdateStatus } from "../types";
import { getDockerApi, useDockerT } from "../runtime";
import { checkableImage, useImageUpdates } from "../useImageUpdates";
import { pullAndMaybeRecreate } from "../updateActions";
import { UpdateBadge } from "./UpdateBadge";
import { ResourceList, usePrune, useRowAction } from "./resourceList";

function fmtSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface Props {
  images: DockerImage[];
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onRefresh: () => void;
}

export function ImageList({ images, sessionId, isRemote, localShell, onRefresh }: Props) {
  const t = useDockerT();
  const prune = usePrune(() => dockerPruneImages({ sessionId, isRemote, localShell }), onRefresh);

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

  const outdatedCount = useMemo(
    () => images.filter((i) => statuses[checkableImage(i.repo_tags[0]) ?? ""]?.status === "outdated").length,
    [images, statuses],
  );
  const isChecking = checking.size > 0;

  return (
    <ResourceList
      count={images.length}
      countLabel={t("imagesCount", { count: images.length })}
      emptyLabel={t("noImages")}
      prune={prune}
      countSuffix={
        outdatedCount > 0 && (
          <span className="ml-1.5 text-(--t-status-warning)">· {t("outdatedCount", { count: outdatedCount })}</span>
        )
      }
      actions={
        <button
          onClick={checkAll}
          disabled={isChecking}
          title={t("checkImageUpdates")}
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm text-(--t-text-muted) hover:bg-(--t-bg-hover) hover:text-(--t-text) disabled:opacity-40"
        >
          <Icon icon="lucide:circle-arrow-up" width={10} className={isChecking ? "animate-pulse" : ""} />
          {isChecking ? t("checking") : t("checkUpdates")}
        </button>
      }
    >
      {images.map((img) => {
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
      })}
    </ResourceList>
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
  const t = useDockerT();
  const [pulling, setPulling] = useState(false);
  const tag = img.repo_tags[0] ?? "<none>";
  const [repo, ver] = tag.includes(":") ? tag.split(":") : [tag, ""];
  const { busy, act: remove } = useRowAction(
    () => dockerRemoveImage({ sessionId, isRemote, localShell }, img.id),
    onRefresh,
    "remove image",
  );

  const update = async () => {
    setPulling(true);
    try {
      if (await pullAndMaybeRecreate({ sessionId, isRemote, localShell, image: tag, recreate: recreateAfterPull })) {
        onUpdated(tag);
      }
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
            recreateAfterPull ? t("pullAndRecreateImage", { image: tag }) : t("pullNewerImageFor", { image: tag })
          }
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--t-status-warning)_14%,transparent)] text-(--t-status-warning) hover:bg-[color-mix(in_srgb,var(--t-status-warning)_24%,transparent)] disabled:opacity-40 shrink-0"
        >
          <Icon
            icon={pulling ? "lucide:loader-circle" : "lucide:download"}
            width={10}
            className={pulling ? "animate-spin" : ""}
          />
          {t(pulling ? (recreateAfterPull ? "updating" : "pulling") : recreateAfterPull ? "update" : "pull")}
        </button>
      )}

      <div className="text-right shrink-0">
        <p className="text-[10px] text-(--t-text-muted)">{fmtSize(img.size)}</p>
        <p className="text-[10px] text-(--t-text-muted)">{(img.created && getDockerApi()?.i18n.formatRelativeTime(img.created * 1000)) || "—"}</p>
      </div>
      <button
        disabled={busy}
        onClick={remove}
        title={t("removeImage")}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-(--t-status-error) opacity-60 hover:opacity-100 disabled:opacity-40 shrink-0"
      >
        <Icon icon="lucide:trash-2" width={11} />
      </button>
    </div>
  );
}
