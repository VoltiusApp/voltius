import { ENTITY_FILES, type BlobPayload } from "@/services/sync";
import type { TimestampedEntity } from "@/services/crdt";

export type DeviceDot = "live" | "syncing" | "behind" | "offline-ok";
export type LanRoute = "lan" | "tailscale" | "vpn";

export interface PeerInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  route: LanRoute;
  address: string;
}

export interface KnownDevice {
  name: string;
  platform: string;
  lastSeen: string;
  lastRoute: string | null;
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

interface CloudDevice {
  device_id: string;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export function entityClocks(payload: BlobPayload): Record<string, string> {
  const clocks: Record<string, string> = {};
  for (const file of ENTITY_FILES) {
    let entities: TimestampedEntity[] = [];
    try { entities = JSON.parse(payload.files[file] ?? "[]"); } catch {}
    for (const e of entities) clocks[`${file}:${e.id}`] = e.updated_at;
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

const cloudName = (d: CloudDevice | undefined): string | undefined => {
  const name = d?.metadata?.device_name;
  return typeof name === "string" && name ? name : undefined;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildDeviceRows(input: {
  selfId: string;
  peers: PeerInfo[];
  known: Record<string, KnownDevice>;
  cloudDevices: CloudDevice[];
  localClocks: Record<string, string>;
  syncing: ReadonlySet<string>;
  peerClocks?: Record<string, Record<string, string>>;
}): DeviceRow[] {
  const { selfId, peers, known, cloudDevices, localClocks, syncing, peerClocks = {} } = input;
  const cloudById = new Map(cloudDevices.map((d) => [d.device_id, d]));
  const peerById = new Map(peers.filter((p) => p.deviceId !== selfId).map((p) => [p.deviceId, p]));
  const ids = new Set([...peerById.keys(), ...Object.keys(known), ...cloudById.keys()]);
  ids.delete(selfId);

  const rows = [...ids].map((deviceId): DeviceRow => {
    const peer = peerById.get(deviceId);
    const k = known[deviceId];
    const cloud = cloudById.get(deviceId);
    const nearby = !!peer;
    const clocks = peerClocks[deviceId];
    const behind = clocks ? countBehind(localClocks, clocks) : 0;
    const dot: DeviceDot = nearby ? (syncing.has(deviceId) ? "syncing" : "live") : behind > 0 ? "behind" : "offline-ok";
    return {
      deviceId,
      name: peer?.deviceName || k?.name || cloudName(cloud) || `Device ${deviceId.slice(0, 6)}`,
      platform: peer?.platform || k?.platform || (typeof cloud?.metadata?.platform === "string" ? cloud.metadata.platform : ""),
      nearby,
      route: peer?.route ?? null,
      dot,
      behind,
      lastSeen: nearby ? null : (k?.lastSeen ?? cloud?.updated_at ?? null),
    };
  });

  return rows.sort((a, b) => {
    if (a.nearby !== b.nearby) return a.nearby ? -1 : 1;
    if (a.nearby) return byText(a.name, b.name) || byText(a.deviceId, b.deviceId);
    return byText(b.lastSeen ?? "", a.lastSeen ?? "") || byText(a.deviceId, b.deviceId);
  });
}
