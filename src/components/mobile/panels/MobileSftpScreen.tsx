import { useMemo } from "react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSftpDir } from "@/services/useSftpDir";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import MobilePanelHeader from "./MobilePanelHeader";
import MobileSftpPane from "./MobileSftpPane";

export default function MobileSftpScreen({ connectionId }: { connectionId: string }) {
  const connections = useAllConnections();
  const connection = useMemo(() => connections.find((c) => c.id === connectionId), [connections, connectionId]);
  const controller = useSftpDir(connection);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader title="SFTP" sessionName={connection ? connectionDisplayName(connection) : undefined} />
      <div className="flex-1 min-h-0">
        <MobileSftpPane
          controller={controller}
          connection={connection}
          selected={[]}
          onToggleSelect={() => {}}
          onPickHost={() => {}}
          onCopyToOther={() => {}}
          otherConnected={false}
        />
      </div>
    </div>
  );
}
