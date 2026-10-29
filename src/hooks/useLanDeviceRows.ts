import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { buildDeviceRows, type DeviceRow } from "@/services/lanSyncDevices";
import { getDeviceId } from "@/services/sync";
import { useLanSyncStore } from "@/stores/lanSyncStore";

export function useLanDeviceRows(): DeviceRow[] {
  const [selfId, setSelfId] = useState("");
  useEffect(() => {
    let alive = true;
    void getDeviceId().then((id) => alive && setSelfId(id));
    return () => {
      alive = false;
    };
  }, []);
  const { peers, known, peerClocks, localClocks, syncing } = useLanSyncStore(
    useShallow(({ peers, known, peerClocks, localClocks, syncing }) => ({ peers, known, peerClocks, localClocks, syncing })),
  );
  return useMemo(
    () => buildDeviceRows({ selfId, peers, known, localClocks, syncing, peerClocks }),
    [selfId, peers, known, peerClocks, localClocks, syncing],
  );
}
