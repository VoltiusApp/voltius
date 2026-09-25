import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ActiveTunnel, TunnelType } from "../types";

export interface PfSessionState {
  tunnels: ActiveTunnel[];
  suppressed_ports: number[];
}

export function getPfState(sessionId: string): Promise<PfSessionState> {
  return invoke("pf_get_state", { sessionId });
}

/** Pushed for every terminal of a host whenever its tunnels change. */
export function onPfStateChanged(
  callback: (sessionId: string, state: PfSessionState) => void,
): Promise<UnlistenFn> {
  return listen<PfSessionState & { session_id: string }>("pf-state-changed", ({ payload }) => {
    callback(payload.session_id, { tunnels: payload.tunnels, suppressed_ports: payload.suppressed_ports });
  });
}

export function openPfTunnel(opts: {
  sessionId: string;
  localPort: number;
  remotePort?: number;
  remoteHost?: string;
  tunnelType?: TunnelType;
  bindHost?: string;
  targetHost?: string;
  ruleId?: string;
  ruleName?: string;
}): Promise<ActiveTunnel> {
  return invoke("pf_tunnel_open", {
    sessionId: opts.sessionId,
    localPort: opts.localPort,
    remotePort: opts.remotePort ?? null,
    remoteHost: opts.remoteHost ?? null,
    tunnelType: opts.tunnelType ?? null,
    bindHost: opts.bindHost ?? null,
    targetHost: opts.targetHost ?? null,
    ruleId: opts.ruleId ?? null,
    ruleName: opts.ruleName ?? null,
  });
}

export function closePfTunnel(sessionId: string, tunnelId: string): Promise<void> {
  return invoke("pf_tunnel_close", { sessionId, tunnelId });
}

export function resumeAutoPort(sessionId: string, port: number): Promise<ActiveTunnel> {
  return invoke("pf_tunnel_resume_auto", { sessionId, port });
}
