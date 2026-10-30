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
  const { peers, known, peerClocks, localClocks, syncing, presence, rejected } = useLanSyncStore(
    useShallow(({ peers, known, peerClocks, localClocks, syncing, presence, rejected }) => ({ peers, known, peerClocks, localClocks, syncing, presence, rejected })),
  );
  return useMemo(
    () => buildDeviceRows({ selfId, peers, known, localClocks, syncing, peerClocks, presence, rejected }),
    [selfId, peers, known, peerClocks, localClocks, syncing, presence, rejected],
  );
}
