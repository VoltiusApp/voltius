import { LAN_GROUP_FILE } from "@/services/lanGroup";
import { ENTITY_FILES, parseEntities, type BlobPayload } from "@/services/sync";

export type DeviceDot = "live" | "syncing" | "behind" | "offline-ok" | "alert";
export type DeviceFlag = "paused" | "keyChanged" | "moved";
export type LanRoute = "lan" | "tailscale" | "vpn";
export type PeerPresence = "live" | "paused" | "moved";

export interface PeerInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  route: LanRoute;
  address: string;
  deviceKey: string;
  files: boolean;
  presence?: PeerPresence | "left";
}

export interface KnownDevice {
  name: string;
  platform: string;
  lastSeen: string;
  lastRoute: string | null;
  deviceKey?: string;
}

export interface DeviceRow {
  deviceId: string;
  name: string;
  platform: string;
  nearby: boolean;
  route: LanRoute | null;
  dot: DeviceDot;
  behind: number;
  lastSeen: string | null;
  flag?: DeviceFlag;
}

export function entityClocks(payload: BlobPayload): Record<string, string> {
  const clocks: Record<string, string> = {};
  for (const file of ENTITY_FILES) {
    if (file === LAN_GROUP_FILE) continue;
    for (const e of parseEntities(payload.files[file])) clocks[`${file}:${e.id}`] = e.updated_at;
  }
  for (const [id, at] of Object.entries(payload.secret_clocks ?? {})) clocks[`secret:${id}`] = at;
  return clocks;
}

export function countBehind(local: Record<string, string>, peer: Record<string, string>): number {
  let n = 0;
  for (const [key, at] of Object.entries(local)) {
    const theirs = peer[key];
    if (theirs === undefined || theirs < at) n++;
  }
  return n;
}

const FLAG_DOT: Record<DeviceFlag, DeviceDot> = { paused: "offline-ok", keyChanged: "alert", moved: "offline-ok" };

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const time = (at: string | null) => Date.parse(at ?? "") || 0;

export function buildDeviceRows(input: {
  selfId: string;
  peers: PeerInfo[];
  known: Record<string, KnownDevice>;
  localClocks: Record<string, string>;
  syncing: ReadonlySet<string>;
  peerClocks?: Record<string, Record<string, string>>;
  presence?: Record<string, PeerPresence>;
  rejected?: Record<string, "keyChanged">;
}): DeviceRow[] {
  const { selfId, peers, known, localClocks, syncing, peerClocks = {}, presence = {}, rejected = {} } = input;
  const peerById = new Map(peers.filter((p) => p.deviceId !== selfId).map((p) => [p.deviceId, p]));
  const ids = new Set([...peerById.keys(), ...Object.keys(known), ...Object.keys(rejected)]);
  ids.delete(selfId);

  const rows = [...ids].map((deviceId): DeviceRow => {
    const peer = peerById.get(deviceId);
    const k = known[deviceId];
    const nearby = !!peer;
    const clocks = peerClocks[deviceId];
    const behind = clocks ? countBehind(localClocks, clocks) : 0;
    const flag: DeviceFlag | undefined = rejected[deviceId] ?? (presence[deviceId] === "live" ? undefined : presence[deviceId]);
    const dot: DeviceDot = flag
      ? FLAG_DOT[flag]
      : nearby ? (syncing.has(deviceId) ? "syncing" : "live") : behind > 0 ? "behind" : "offline-ok";
    return {
      deviceId,
      name: peer?.deviceName || k?.name || `Device ${deviceId.slice(0, 6)}`,
      platform: peer?.platform || k?.platform || "",
      nearby,
      route: peer?.route ?? null,
      dot,
      behind,
      lastSeen: nearby ? null : (k?.lastSeen ?? null),
      ...(flag ? { flag } : {}),
    };
  });

  return rows.sort((a, b) => {
    if (a.nearby !== b.nearby) return a.nearby ? -1 : 1;
    if (a.nearby) return byText(a.name, b.name) || byText(a.deviceId, b.deviceId);
    return time(b.lastSeen) - time(a.lastSeen) || byText(a.deviceId, b.deviceId);
  });
}
