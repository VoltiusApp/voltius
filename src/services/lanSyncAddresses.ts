import { invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";
import { getDeviceId, onRemotePayloadMerged, type BlobPayload } from "@/services/sync";

const ADDRS_FILE = "lan_sync_addresses.json";
const MAX_ADDRS = 16;

const latest = new Map<string, string[]>();
let learning = false;
let ignoring = false;

export function addressesFrom(deviceId: string, selfId: string, payload: BlobPayload): string[] {
  const raw = payload.files[ADDRS_FILE];
  if (!raw || deviceId === selfId) return [];
  try {
    const file = JSON.parse(raw) as { v?: unknown; deviceId?: unknown; addrs?: unknown };
    if (file.v !== 1 || file.deviceId !== deviceId || !Array.isArray(file.addrs)) return [];
    return file.addrs.filter((a): a is string => typeof a === "string").slice(0, MAX_ADDRS);
  } catch {
    return [];
  }
}

function learn(deviceId: string, addrs: string[]): void {
  invoke("lan_sync_learn", { deviceId, addrs }).catch(logFailure("lan-sync learn"));
}

// Subscribed at import: launch-time pulls merge before any LAN session exists.
onRemotePayloadMerged((deviceId, payload) => {
  getDeviceId()
    .then((selfId) => {
      if (ignoring) return;
      const addrs = addressesFrom(deviceId, selfId, payload);
      if (addrs.length === 0) {
        latest.delete(deviceId);
        return;
      }
      latest.set(deviceId, addrs);
      if (learning) learn(deviceId, addrs);
    })
    .catch(logFailure("lan-sync learn"));
});

// A group or farewell session: nothing merged before or during it may reach a later account manager.
export function ignorePeerAddresses(): () => void {
  ignoring = true;
  latest.clear();
  return () => {
    ignoring = false;
  };
}

export function watchPeerAddresses(): () => void {
  learning = true;
  latest.forEach((addrs, deviceId) => learn(deviceId, addrs));
  return () => {
    learning = false;
  };
}
