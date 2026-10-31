import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import { logFailure } from "@/lib/logger";
import { entityClocks, type KnownDevice, type PeerInfo, type PeerPresence } from "@/services/lanSyncDevices";
import { getDeviceId, onRemotePayloadMerged, type BlobPayload } from "@/services/sync";

export type LanStatus = "running" | "paused" | "blocked" | "stopped";
export type Presence = PeerPresence;
export type PairRole = "host" | "joiner";

export interface Pairing {
  state: "idle" | "searching" | "code" | "peerConfirmed" | "joining" | "done" | "ended";
  sas?: number;
  role?: PairRole;
  peerName?: string;
  peerHasData?: boolean;
  reason?: string;
  closed?: boolean;
  granted?: boolean;
  replaces?: string;
}

export const IDLE_PAIRING: Pairing = { state: "idle" };

interface LanSyncStore {
  status: LanStatus;
  peers: PeerInfo[];
  syncing: Set<string>;
  paused: boolean;
  known: Record<string, KnownDevice>;
  knownScope?: string;
  peerClocks: Record<string, Record<string, string>>;
  localClocks: Record<string, string>;
  introShown: boolean;
  pairing: Pairing;
  presence: Record<string, Presence>;
  rejected: Record<string, "keyChanged">;
  setStatus: (status: LanStatus) => void;
  setPeers: (peers: PeerInfo[]) => void;
  markSyncing: (deviceId: string, on: boolean) => void;
  setPaused: (paused: boolean) => void;
  setIntroShown: (introShown: boolean) => void;
  setLocalClocks: (localClocks: Record<string, string>) => void;
  rememberDevice: (peer: PeerInfo) => boolean;
  recordPeerPayload: (deviceId: string, payload: BlobPayload) => void;
  setPairing: (pairing: Pairing) => void;
  setPresence: (deviceId: string, presence: Presence) => void;
  markRejected: (deviceId: string, reason: "keyChanged") => void;
  clearRejected: (deviceIds: string[]) => void;
  dropDevice: (deviceId: string) => void;
  forgetAccount: () => void;
  adoptScope: (scope: string) => void;
}

function without<T>(record: Record<string, T>, ...ids: string[]): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => !ids.includes(id)));
}

type Persisted = Pick<LanSyncStore, "paused" | "introShown" | "known" | "knownScope" | "peerClocks">;

export const LAN_SYNC_DEVICES_KEY = "voltius-lan-sync-devices";
export const LAN_SYNC_CLOCKS_KEY = "voltius-lan-sync-clocks";

const slices = (name: string): [string, (keyof Persisted)[]][] => [
  [name, ["paused", "introShown"]],
  [LAN_SYNC_DEVICES_KEY, ["known", "knownScope"]],
  [LAN_SYNC_CLOCKS_KEY, ["peerClocks"]],
];

const forgottenDevices = () => ({
  known: {},
  peerClocks: {},
  localClocks: {},
  peers: [],
  syncing: new Set<string>(),
  presence: {},
  rejected: {},
});

function readSlice(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null");
    return (parsed as { state?: Record<string, unknown> } | null)?.state ?? {};
  } catch {
    return {};
  }
}

// Writes only slices whose values changed, so hot-path sets never re-serialize every clock.
function splitStorage(): PersistStorage<Persisted> {
  const written = new Map<string, unknown[]>();
  return {
    getItem: (name) => {
      const state: Record<string, unknown> = {};
      for (const [key, fields] of slices(name)) {
        const slice = readSlice(key);
        for (const f of fields) if (f in slice) state[f] = slice[f];
        written.set(key, fields.map((f) => state[f]));
      }
      return { state: state as Persisted, version: 0 };
    },
    setItem: (name, { state, version }) => {
      for (const [key, fields] of slices(name)) {
        const values = fields.map((f) => state[f]);
        if (written.get(key)?.every((v, i) => v === values[i])) continue;
        written.set(key, values);
        globalThis.localStorage?.setItem(key, JSON.stringify({ state: Object.fromEntries(fields.map((f, i) => [f, values[i]])), version }));
      }
    },
    removeItem: (name) => {
      written.clear();
      for (const [key] of slices(name)) globalThis.localStorage?.removeItem(key);
    },
  };
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
      pairing: IDLE_PAIRING,
      presence: {},
      rejected: {},
      setStatus: (status) => set({ status }),
      setPeers: (peers) =>
        set((s) => {
          const present = new Set(peers.map((p) => p.deviceId));
          const lastSeen = new Date().toISOString();
          const known = { ...s.known };
          for (const { deviceId } of s.peers) {
            if (!present.has(deviceId) && known[deviceId]) known[deviceId] = { ...known[deviceId], lastSeen };
          }
          const presence = { ...s.presence };
          for (const p of peers) if (p.presence && p.presence !== "left") presence[p.deviceId] = p.presence;
          return {
            peers,
            known,
            presence,
            rejected: without(s.rejected, ...present),
            syncing: new Set([...s.syncing].filter((id) => present.has(id))),
          };
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
              deviceKey: peer.deviceKey,
            },
          },
        }));
        return isNew;
      },
      recordPeerPayload: (deviceId, payload) => {
        if (!(deviceId in get().known)) return;
        set((s) => ({ peerClocks: { ...s.peerClocks, [deviceId]: entityClocks(payload) } }));
      },
      setPairing: (pairing) => set({ pairing }),
      setPresence: (deviceId, presence) => set((s) => ({ presence: { ...s.presence, [deviceId]: presence } })),
      markRejected: (deviceId, reason) => set((s) => ({ rejected: { ...s.rejected, [deviceId]: reason } })),
      clearRejected: (deviceIds) => set((s) => ({ rejected: without(s.rejected, ...deviceIds) })),
      dropDevice: (deviceId) =>
        set((s) => ({
          known: without(s.known, deviceId),
          peerClocks: without(s.peerClocks, deviceId),
          presence: without(s.presence, deviceId),
          rejected: without(s.rejected, deviceId),
        })),
      forgetAccount: () => set(forgottenDevices()),
      // Rows kept from before the scope was recorded stay; they can only be this install's own.
      adoptScope: (scope) => {
        const held = get().knownScope;
        if (held !== scope) set(held === undefined ? { knownScope: scope } : { ...forgottenDevices(), knownScope: scope });
      },
    }),
    {
      name: "voltius-lan-sync",
      storage: splitStorage(),
      partialize: ({ paused, known, knownScope, peerClocks, introShown }) => ({ paused, known, knownScope, peerClocks, introShown }),
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
