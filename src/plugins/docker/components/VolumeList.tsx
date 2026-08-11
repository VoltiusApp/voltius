import { dockerPruneVolumes, dockerRemoveVolume } from "../services";
import type { DockerVolume } from "../types";
import { ResourceList, ResourceRow, usePrune } from "./resourceList";

interface Props {
  volumes: DockerVolume[];
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onRefresh: () => void;
}

export function VolumeList({ volumes, sessionId, isRemote, localShell, onRefresh }: Props) {
  const ctx = { sessionId, isRemote, localShell };
  const prune = usePrune(() => dockerPruneVolumes(ctx), onRefresh);

  return (
    <ResourceList
      count={volumes.length}
      noun="volumes"
      emptyLabel="No volumes"
      prune={prune}
    >
      {volumes.map((v) => (
        <ResourceRow
          key={v.name}
          title={<p className="text-[11px] text-(--t-text) truncate font-mono">{v.name}</p>}
          subtitle={<p className="text-[10px] text-(--t-text-muted)">{v.driver}</p>}
          removeTitle="Remove volume"
          onRemove={() => dockerRemoveVolume(ctx, v.name)}
          onRefresh={onRefresh}
        />
      ))}
    </ResourceList>
  );
}
