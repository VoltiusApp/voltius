import { useAllConnections } from "@/hooks/useAllConnections";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { isFileOnlyProtocol, isWebProtocol } from "@/utils/connectionType";
import { connectionTarget, refuseWhilePreviewing } from "@/services/previewGuard";

/** Open a host the way tapping it on Hosts does: a new terminal session (and the terminal tab),
 *  or the file browser for file-only protocols (FTP, WebDAV) that have no terminal. */
export function useOpenHost(): (id: string) => void {
  const connections = useAllConnections();
  const connect = useSessionStore((s) => s.connect);
  const setTab = useMobileNavStore((s) => s.setTab);
  const push = useMobileNavStore((s) => s.push);
  return (id) => {
    if (refuseWhilePreviewing(connectionTarget(id))) return;
    const c = connections.find((x) => x.id === id);
    if (c && isFileOnlyProtocol(c)) {
      push({ kind: "panel-sftp", connectionId: id });
      return;
    }
    void connect(id).catch(console.error);
    if (!(c && isWebProtocol(c))) setTab("terminal");
  };
}
