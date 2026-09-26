import { dockerPruneVolumes, dockerRemoveVolume } from "../services";
import type { DockerVolume } from "../types";
import { useDockerT } from "../runtime";
import { ResourceList, ResourceRow, usePrune } from "./resourceList";

interface Props {
  volumes: DockerVolume[];
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onRefresh: () => void;
}

export function VolumeList({ volumes, sessionId, isRemote, localShell, onRefresh }: Props) {
  const t = useDockerT();
  const ctx = { sessionId, isRemote, localShell };
  const prune = usePrune(() => dockerPruneVolumes(ctx), onRefresh);

  return (
    <ResourceList
      count={volumes.length}
      countLabel={t("volumesCount", { count: volumes.length })}
      emptyLabel={t("noVolumes")}
      prune={prune}
    >
      {volumes.map((v) => (
        <ResourceRow
          key={v.name}
          title={<p className="text-[11px] text-(--t-text) truncate font-mono">{v.name}</p>}
          subtitle={<p className="text-[10px] text-(--t-text-muted)">{v.driver}</p>}
          removeTitle={t("removeVolume")}
          onRemove={() => dockerRemoveVolume(ctx, v.name)}
          onRefresh={onRefresh}
        />
      ))}
    </ResourceList>
  );
}
