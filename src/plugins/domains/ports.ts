import type { ActiveTunnel } from "@/types";

export interface ReachDeps {
  getState(sessionId: string): Promise<{ tunnels: ActiveTunnel[] }>;
  openTunnel(o: {
    sessionId: string;
    localPort: number;
    remotePort: number;
    remoteHost: string;
    tunnelType: "local";
  }): Promise<ActiveTunnel>;
}

export interface ReachPortOpts {
  sessionId: string;
  isRemote: boolean;
  hostPort: number;
  hostIp?: string | null;
  scheme?: "http" | "https";
  action: "browser" | "copy";
}

export interface ReachPortResult {
  address: string;
  localPort: number;
  tunneled: boolean;
}

const WILDCARD_BINDS = new Set(["", "0.0.0.0", "::", "[::]", "*"]);

/** A published port bound to a wildcard has no usable address on the far side of
 *  the SSH channel; loopback is what the tunnel's remote end can actually dial. */
export function remoteHostFor(hostIp: string | null | undefined): string {
  return !hostIp || WILDCARD_BINDS.has(hostIp) ? "127.0.0.1" : hostIp;
}

function addressFor(opts: ReachPortOpts, localPort: number): string {
  if (opts.action === "copy") return `localhost:${localPort}`;
  return `${opts.scheme ?? "http"}://localhost:${localPort}`;
}

export async function resolvePort(deps: ReachDeps, opts: ReachPortOpts): Promise<ReachPortResult> {
  if (!opts.isRemote) {
    return { address: addressFor(opts, opts.hostPort), localPort: opts.hostPort, tunneled: false };
  }

  const { tunnels } = await deps.getState(opts.sessionId);
  const live = tunnels.find(
    (t) => t.tunnel_type === "local" && t.remote_port === opts.hostPort && t.state === "active",
  );
  if (live) {
    return { address: addressFor(opts, live.local_port), localPort: live.local_port, tunneled: false };
  }

  // bind_with_fallback picks another port when this one is taken, so the bound
  // port — not the requested one — is what the address has to use.
  const opened = await deps.openTunnel({
    sessionId: opts.sessionId,
    localPort: opts.hostPort,
    remotePort: opts.hostPort,
    remoteHost: remoteHostFor(opts.hostIp),
    tunnelType: "local",
  });
  return { address: addressFor(opts, opened.local_port), localPort: opened.local_port, tunneled: true };
}
