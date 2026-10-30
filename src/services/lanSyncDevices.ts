import { ENTITY_FILES, parseEntities, type BlobPayload } from "@/services/sync";

export type DeviceDot = "live" | "syncing" | "behind" | "offline-ok";
export type LanRoute = "lan" | "tailscale" | "vpn";

export interface PeerInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  route: LanRoute;
  address: string;
  deviceKey: string;
  files: boolean;
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
}

export function entityClocks(payload: BlobPayload): Record<string, string> {
  const clocks: Record<string, string> = {};
  for (const file of ENTITY_FILES) {
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

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const time = (at: string | null) => Date.parse(at ?? "") || 0;

export function buildDeviceRows(input: {
  selfId: string;
  peers: PeerInfo[];
  known: Record<string, KnownDevice>;
  localClocks: Record<string, string>;
  syncing: ReadonlySet<string>;
  peerClocks?: Record<string, Record<string, string>>;
}): DeviceRow[] {
  const { selfId, peers, known, localClocks, syncing, peerClocks = {} } = input;
  const peerById = new Map(peers.filter((p) => p.deviceId !== selfId).map((p) => [p.deviceId, p]));
  const ids = new Set([...peerById.keys(), ...Object.keys(known)]);
  ids.delete(selfId);

  const rows = [...ids].map((deviceId): DeviceRow => {
    const peer = peerById.get(deviceId);
    const k = known[deviceId];
    const nearby = !!peer;
    const clocks = peerClocks[deviceId];
    const behind = clocks ? countBehind(localClocks, clocks) : 0;
    const dot: DeviceDot = nearby ? (syncing.has(deviceId) ? "syncing" : "live") : behind > 0 ? "behind" : "offline-ok";
    return {
      deviceId,
      name: peer?.deviceName || k?.name || `Device ${deviceId.slice(0, 6)}`,
      platform: peer?.platform || k?.platform || "",
      nearby,
      route: peer?.route ?? null,
      dot,
      behind,
      lastSeen: nearby ? null : (k?.lastSeen ?? null),
    };
  });

  return rows.sort((a, b) => {
    if (a.nearby !== b.nearby) return a.nearby ? -1 : 1;
    if (a.nearby) return byText(a.name, b.name) || byText(a.deviceId, b.deviceId);
    return time(b.lastSeen) - time(a.lastSeen) || byText(a.deviceId, b.deviceId);
  });
}
