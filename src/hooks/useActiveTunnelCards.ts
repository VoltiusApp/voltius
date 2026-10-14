import { useMemo, useState } from "react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useConnectedSshPfStates } from "@/hooks/usePfStates";
import { closePfTunnel, resumeAutoPort } from "@/services/portForwardingTunnels";
import type { ActiveTunnel } from "@/types";

/** Non-rule tunnels and paused auto ports per connected host, with their pause/resume actions. */
export function useActiveTunnelCards() {
  const connections = useAllConnections();
  const { sessions: relevantSessions, pfStates: pfStateMap } = useConnectedSshPfStates();

  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [hiddenPorts, setHiddenPorts] = useState<Set<string>>(new Set());

  // Port forwarding is host-scoped: terminals of the same host share one tunnel
  // list, so collapse to a single card per host (first session per connection).
  const hostSessions = useMemo(() => {
    const seen = new Set<string>();
    return relevantSessions.filter((s) => {
      if (seen.has(s.connectionId)) return false;
      seen.add(s.connectionId);
      return true;
    });
  }, [relevantSessions]);

  const sessionCards = useMemo(() => {
    return hostSessions
      .map((session) => {
        const connection = connections.find((c) => c.id === session.connectionId) ?? null;
        const state = pfStateMap.get(session.id);
        const tunnels = (state?.tunnels ?? []).filter((tunnel) => tunnel.origin.type !== "rule" && !hiddenPorts.has(`${session.id}:${tunnel.remote_port}`));
        const activePorts = new Set(tunnels.map((tunnel) => tunnel.remote_port));
        const suppressedPorts = (state?.suppressed_ports ?? []).filter((port) => !activePorts.has(port) && !hiddenPorts.has(`${session.id}:${port}`));
        const errorCount = tunnels.filter((tunnel) => typeof tunnel.state === "object" && "error" in tunnel.state).length;
        return { session, connection, tunnels, suppressedPorts, errorCount };
      })
      .filter(({ tunnels, suppressedPorts }) => tunnels.length > 0 || suppressedPorts.length > 0);
  }, [hostSessions, connections, pfStateMap, hiddenPorts]);

  const totalTunnelCount = sessionCards.reduce((sum, card) => sum + card.tunnels.length + card.suppressedPorts.length, 0);
  const totalErrorCount = sessionCards.reduce((sum, card) => sum + card.errorCount, 0);

  async function withBusy(key: string, op: string, run: () => Promise<unknown>) {
    setBusy((prev) => new Set(prev).add(key));
    try { await run(); }
    catch (e) { console.error(`${op} failed:`, e); }
    finally {
      setBusy((prev) => {
        const s = new Set(prev);
        s.delete(key);
        return s;
      });
    }
  }

  const hide = (sessionId: string, port: number) => setHiddenPorts((prev) => new Set([...prev, `${sessionId}:${port}`]));

  return {
    sessionCards,
    totalTunnelCount,
    totalErrorCount,
    isKeyBusy: (key: string) => busy.has(key),
    pause: (sessionId: string, tunnelId: string) =>
      withBusy(`${sessionId}-${tunnelId}`, "pf_tunnel_close", () => closePfTunnel(sessionId, tunnelId)),
    resume: (sessionId: string, port: number) =>
      withBusy(`${sessionId}-${port}`, "pf_tunnel_resume_auto", () => resumeAutoPort(sessionId, port)),
    deleteActive: (sessionId: string, tunnel: ActiveTunnel) =>
      withBusy(`del-${sessionId}-${tunnel.id}`, "pf_tunnel_close", async () => {
        await closePfTunnel(sessionId, tunnel.id);
        hide(sessionId, tunnel.remote_port);
      }),
    deletePaused: hide,
  };
}
