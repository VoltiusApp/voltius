import { create } from "zustand";
import { persist } from "zustand/middleware";
import { logFailure } from "@/lib/logger";
import { entityClocks, type KnownDevice, type PeerInfo } from "@/services/lanSyncDevices";
import { getDeviceId, onRemotePayloadMerged, type BlobPayload } from "@/services/sync";

export type LanStatus = "running" | "paused" | "blocked" | "stopped";

// Cloud-only devices are re-recorded on every pull; the least recently recorded are dropped first.
const MAX_UNKNOWN_PEER_CLOCKS = 16;

interface LanSyncStore {
  status: LanStatus;
  peers: PeerInfo[];
  syncing: Set<string>;
  paused: boolean;
  known: Record<string, KnownDevice>;
  peerClocks: Record<string, Record<string, string>>;
  localClocks: Record<string, string>;
  introShown: boolean;
  setStatus: (status: LanStatus) => void;
  setPeers: (peers: PeerInfo[]) => void;
  markSyncing: (deviceId: string, on: boolean) => void;
  setPaused: (paused: boolean) => void;
  setIntroShown: (introShown: boolean) => void;
  setLocalClocks: (localClocks: Record<string, string>) => void;
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
      localClocks: {},
      introShown: false,
      setStatus: (status) => set({ status }),
      setPeers: (peers) =>
        set((s) => {
          const present = new Set(peers.map((p) => p.deviceId));
          return { peers, syncing: new Set([...s.syncing].filter((id) => present.has(id))) };
        }),
      markSyncing: (deviceId, on) =>
        set((s) => {
          const syncing = new Set(s.syncing);
          if (on) syncing.add(deviceId);
          else syncing.delete(deviceId);
          return { syncing };
        }),
      setPaused: (paused) => set({ paused }),
      setIntroShown: (introShown) => set({ introShown }),
      setLocalClocks: (localClocks) => set({ localClocks }),
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
        set((s) => {
          const peerClocks = { ...s.peerClocks };
          delete peerClocks[deviceId];
          const strangers = Object.keys(peerClocks).filter((id) => !(id in s.known));
          for (const id of strangers.slice(0, Math.max(0, strangers.length - MAX_UNKNOWN_PEER_CLOCKS + 1))) delete peerClocks[id];
          return { peerClocks: { ...peerClocks, [deviceId]: entityClocks(payload) } };
        }),
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
    .catch(logFailure("lan-sync peer clocks"));
});
