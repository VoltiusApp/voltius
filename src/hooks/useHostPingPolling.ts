import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { getSecret } from "@/services/vault";
import type { Connection } from "@/types";
import type { JumpHostConnect } from "@/services/ssh";

const POLL_INTERVAL_MS = 30_000;

async function resolveJumpHosts(connection: Connection): Promise<JumpHostConnect[]> {
  if (!connection.jump_hosts?.length) return [];
  const identities = useIdentityStore.getState().identities;
  return Promise.all(
    connection.jump_hosts.map(async (jh) => {
      if (jh.identity_id) {
        const identity = identities.find((i) => i.id === jh.identity_id);
        if (identity) {
          const pwd = (await getSecret(`identity:${jh.identity_id}:password`).catch(() => null)) ?? undefined;
          const pk = identity.key_id
            ? (await getSecret(`key:${identity.key_id}:private`).catch(() => null)) ?? undefined
            : undefined;
          return { host: jh.host, port: jh.port, username: identity.username, password: pwd, privateKey: pk };
        }
      }
      const pwd = (await getSecret(`password:${jh.connection_id}`).catch(() => null)) ?? undefined;
      const pk = (await getSecret(`key:${jh.connection_id}`).catch(() => null)) ?? undefined;
      return { host: jh.host, port: jh.port, username: jh.username, password: pwd, privateKey: pk };
    }),
  );
}

export function useHostPingPolling() {
  const enabled = useHostPingStore((s) => s.enabled);
  const connections = useConnectionStore((s) => s.connections);
  const setStatus = useHostPingStore((s) => s.setStatus);
  const clearStatuses = useHostPingStore((s) => s.clearStatuses);

  useEffect(() => {
    if (!enabled) {
      clearStatuses();
      return;
    }

    const toCheck = connections.filter((c) => !c.ping_disabled);
    if (toCheck.length === 0) return;

    let cancelled = false;

    const pollAll = async () => {
      await Promise.allSettled(
        toCheck.map(async (c) => {
          try {
            let up: boolean;
            if (c.jump_hosts?.length) {
              const jumpHosts = await resolveJumpHosts(c);
              up = await invoke<boolean>("ping_host_via_jumps", {
                host: c.host,
                port: c.port,
                jumpHosts,
              });
            } else {
              up = await invoke<boolean>("ping_host", { host: c.host, port: c.port });
            }
            if (!cancelled) setStatus(c.id, up ? "up" : "down");
          } catch {
            if (!cancelled) setStatus(c.id, "unknown");
          }
        }),
      );
    };

    pollAll();
    const interval = setInterval(pollAll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, connections, setStatus, clearStatuses]);
}
