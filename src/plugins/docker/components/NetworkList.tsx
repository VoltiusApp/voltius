import { dockerPruneNetworks, dockerRemoveNetwork } from "../services";
import type { DockerNetwork } from "../types";
import { ResourceList, ResourceRow, usePrune } from "./resourceList";

interface Props {
  networks: DockerNetwork[];
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onRefresh: () => void;
}

export function NetworkList({ networks, sessionId, isRemote, localShell, onRefresh }: Props) {
  const ctx = { sessionId, isRemote, localShell };
  const prune = usePrune(() => dockerPruneNetworks(ctx), onRefresh);

  return (
    <ResourceList
      count={networks.length}
      noun="networks"
      emptyLabel="No networks"
      prune={prune}
    >
      {networks.map((n) => (
        <ResourceRow
          key={n.id}
          title={<p className="text-[11px] text-(--t-text) truncate">{n.name}</p>}
          subtitle={<p className="text-[10px] text-(--t-text-muted) font-mono">{n.driver}</p>}
          trailing={
            <p className="text-[10px] text-(--t-text-muted) font-mono shrink-0">
              {n.id.slice(0, 12)}
            </p>
          }
          removeTitle="Remove network"
          onRemove={() => dockerRemoveNetwork(ctx, n.id)}
          onRefresh={onRefresh}
        />
      ))}
    </ResourceList>
  );
}
