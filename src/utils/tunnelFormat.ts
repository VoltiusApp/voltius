import type { ActiveTunnel, PortForwardingRule, TunnelType } from "@/types";

export function formatRuleLabel(rule: PortForwardingRule): string {
  return formatTunnelLabel(rule.tunnel_type ?? "local", {
    localPort: rule.local_port,
    remotePort: rule.remote_port,
    remoteHost: rule.remote_host,
    bindHost: rule.bind_host ?? "127.0.0.1",
    targetHost: rule.target_host ?? "127.0.0.1",
  });
}

export function formatActiveTunnelLabel(tunnel: ActiveTunnel): string {
  return formatTunnelLabel(tunnel.tunnel_type ?? "local", {
    localPort: tunnel.local_port,
    remotePort: tunnel.remote_port,
    remoteHost: tunnel.remote_host,
    bindHost: tunnel.bind_host ?? "127.0.0.1",
    targetHost: tunnel.target_host ?? "127.0.0.1",
  });
}

function formatTunnelLabel(
  type: TunnelType,
  opts: { localPort: number; remotePort: number; remoteHost: string; bindHost: string; targetHost: string },
): string {
  switch (type) {
    case "remote":
      return `${opts.bindHost}:${opts.remotePort} → ${opts.targetHost}:${opts.localPort}`;
    case "dynamic":
      return `:${opts.localPort} (SOCKS5)`;
    default:
      return `${opts.localPort} → ${opts.remoteHost}:${opts.remotePort}`;
  }
}

const HTTP_PORTS = new Set([80, 3000, 3001, 4000, 4200, 5000, 5173, 5174, 8000, 8008, 8080, 8888]);
const HTTPS_PORTS = new Set([443, 8443]);

/** Returns an HTTP URL only for local tunnels where remotePort identifies the service. */
export function getLocalTunnelHttpUrl(
  tunnelType: TunnelType,
  remotePort: number,
  localPort: number,
): string | null {
  if (tunnelType !== "local") return null;
  if (HTTP_PORTS.has(remotePort)) return `http://localhost:${localPort}`;
  if (HTTPS_PORTS.has(remotePort)) return `https://localhost:${localPort}`;
  return null;
}
