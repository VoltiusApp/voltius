import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export function useReadOnlyFlips(sftpId: string | null, apply: (readOnly: boolean) => void) {
  useEffect(() => {
    if (!sftpId) return;
    const unlisten = listen<{ readOnly: boolean }>(`sftp-readonly-${sftpId}`, ({ payload }) => apply(payload.readOnly));
    return () => { void unlisten.then((fn) => fn()); };
  }, [sftpId, apply]);
}
