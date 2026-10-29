import { create } from "zustand";
import { persist } from "zustand/middleware";
import { entityClocks, type KnownDevice, type PeerInfo } from "@/services/lanSyncDevices";
import { getDeviceId, onRemotePayloadMerged, type BlobPayload } from "@/services/sync";

export type LanStatus = "running" | "paused" | "blocked" | "stopped";

interface LanSyncStore {
  status: LanStatus;
  peers: PeerInfo[];
  syncing: Set<string>;
  paused: boolean;
  known: Record<string, KnownDevice>;
  peerClocks: Record<string, Record<string, string>>;
  introShown: boolean;
  setStatus: (status: LanStatus) => void;
  setPeers: (peers: PeerInfo[]) => void;
  markSyncing: (deviceId: string, on: boolean) => void;
  setPaused: (paused: boolean) => void;
  setIntroShown: (introShown: boolean) => void;
  rememberDevice: (peer: PeerInfo) => boolean;
  recordPeerPayload: (deviceId: string, payload: BlobPayload) => void;
}

export const useLanSyncStore = create<LanSyncStore>()(
  persist(
    (set, get) => ({
      status: "stopped",
      peers: [],
      syncing: new Set<string>(),
      paused: false,
      known: {},
      peerClocks: {},
      introShown: false,
      setStatus: (status) => set({ status }),
      setPeers: (peers) => set({ peers }),
      markSyncing: (deviceId, on) =>
        set((s) => {
          const syncing = new Set(s.syncing);
          if (on) syncing.add(deviceId);
          else syncing.delete(deviceId);
          return { syncing };
        }),
      setPaused: (paused) => set({ paused }),
      setIntroShown: (introShown) => set({ introShown }),
      rememberDevice: (peer) => {
        const isNew = !(peer.deviceId in get().known);
        set((s) => ({
          known: {
            ...s.known,
            [peer.deviceId]: {
              name: peer.deviceName,
              platform: peer.platform,
              lastSeen: new Date().toISOString(),
              lastRoute: peer.route,
            },
          },
        }));
        return isNew;
      },
      recordPeerPayload: (deviceId, payload) =>
        set((s) => ({ peerClocks: { ...s.peerClocks, [deviceId]: entityClocks(payload) } })),
    }),
    {
      name: "voltius-lan-sync",
      partialize: ({ paused, known, peerClocks, introShown }) => ({ paused, known, peerClocks, introShown }),
    },
  ),
);

onRemotePayloadMerged((deviceId, payload) => {
  getDeviceId()
    .then((selfId) => {
      if (deviceId !== selfId) useLanSyncStore.getState().recordPeerPayload(deviceId, payload);
    })
    .catch(() => {});
});
