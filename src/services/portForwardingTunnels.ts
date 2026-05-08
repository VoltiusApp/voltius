import { invoke } from "@tauri-apps/api/core";
import type { ActiveTunnel, TunnelType } from "../types";

export interface PfSessionState {
  tunnels: ActiveTunnel[];
  suppressed_ports: number[];
}

export function getPfState(sessionId: string): Promise<PfSessionState> {
  return invoke("pf_get_state", { sessionId });
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
