import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { getDeviceId } from "@/services/sync";
import type { KnownDevice, LanRoute, PeerInfo } from "@/services/lanSyncDevices";

export type MyDeviceState = "ready" | "off" | "offline";

export interface MyDevice {
  deviceId: string;
  deviceKey: string | null;
  name: string;
  platform: string;
  state: MyDeviceState;
  route: LanRoute | null;
  lastSeen: string | null;
}

export function routeLabel(t: TFunction, route: LanRoute): string {
  return t(`layout.sync.local.route.${route}`);
}

const byName = (a: MyDevice, b: MyDevice) => a.name.localeCompare(b.name);
const time = (at: string | null) => Date.parse(at ?? "") || 0;
const RANK: Record<MyDeviceState, number> = { ready: 0, off: 1, offline: 2 };

export function buildMyDevices(input: {
  selfId: string;
  peers: PeerInfo[];
  known: Record<string, KnownDevice>;
}): MyDevice[] {
  const { selfId, peers, known } = input;
  const live = new Map(peers.map((p) => [p.deviceId, p]));
  const rows: MyDevice[] = [];
  for (const p of live.values()) {
    rows.push({
      deviceId: p.deviceId,
      deviceKey: p.deviceKey,
      name: p.deviceName,
      platform: p.platform,
      state: p.files ? "ready" : "off",
      route: p.route,
      lastSeen: null,
    });
  }
  for (const [deviceId, k] of Object.entries(known)) {
    if (live.has(deviceId)) continue;
    rows.push({
      deviceId,
      deviceKey: k.deviceKey ?? null,
      name: k.name,
      platform: k.platform,
      state: "offline",
      route: null,
      lastSeen: k.lastSeen,
    });
  }
  return rows
    .filter((r) => r.deviceId !== selfId && r.platform !== "android")
    .sort((a, b) => RANK[a.state] - RANK[b.state] || (a.state === "offline" ? time(b.lastSeen) - time(a.lastSeen) : byName(a, b)));
}

export function useMyDevices(): MyDevice[] {
  const peers = useLanSyncStore((s) => s.peers);
  const known = useLanSyncStore((s) => s.known);
  const [selfId, setSelfId] = useState("");
  useEffect(() => {
    void getDeviceId().then(setSelfId);
  }, []);
  return useMemo(() => buildMyDevices({ selfId, peers, known }), [selfId, peers, known]);
}
