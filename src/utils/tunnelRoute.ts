import type { TunnelType } from "@/types";
import { bareHost, isLoopbackHost, isWildcardHost } from "@/utils/tunnelFormat";

export type Audience = "private" | "network" | "custom";

const LOOPBACK = "127.0.0.1";

export const AUDIENCE_HOST = { private: LOOPBACK, network: "0.0.0.0" } as const;

export function audienceOf(bindHost: string): Audience {
  if (isLoopbackHost(bindHost)) return "private";
  return isWildcardHost(bindHost) ? "network" : "custom";
}

export interface RouteInput {
  tunnelType: TunnelType;
  localPort: string;
  remotePort: string;
  bindHost: string;
  remoteHost: string;
  targetHost: string;
}

export interface RoutePlaceholders {
  /** Stands for whichever of this machine's addresses another device uses. */
  anyAddress: string;
  sshTarget: string;
}

export interface RouteSummary {
  variant: "local" | "localShared" | "remote" | "dynamic" | "dynamicShared";
  listener: string;
  target: string;
  command: string;
}

function endpoint(host: string, port: string): string {
  const bare = bareHost(host) || LOOPBACK;
  return `${bare.includes(":") ? `[${bare}]` : bare}:${port}`;
}

const isPort = (value: string) => /^\d+$/.test(value.trim());

export function describeRoute(input: RouteInput, placeholders: RoutePlaceholders): RouteSummary | null {
  const { tunnelType, bindHost } = input;
  const localPort = input.localPort.trim();
  const remotePort = input.remotePort.trim();
  if (!isPort(localPort) || (tunnelType !== "dynamic" && !isPort(remotePort))) return null;

  const audience = audienceOf(bindHost);
  const bindArg = audience === "private" ? "" : endpoint(bindHost, "");
  const { sshTarget } = placeholders;

  if (tunnelType === "remote") {
    const target = endpoint(input.targetHost, localPort);
    return {
      variant: "remote",
      listener: endpoint(bindHost, remotePort),
      target,
      command: `ssh -R ${bindArg}${remotePort}:${target} ${sshTarget}`,
    };
  }

  const shared = audience !== "private";
  const listener = audience === "private"
    ? `localhost:${localPort}`
    : audience === "network" ? `${placeholders.anyAddress}:${localPort}` : endpoint(bindHost, localPort);
  if (tunnelType === "dynamic") {
    return {
      variant: shared ? "dynamicShared" : "dynamic",
      listener,
      target: "",
      command: `ssh -D ${bindArg}${localPort} ${sshTarget}`,
    };
  }
  const target = endpoint(input.remoteHost, remotePort);
  return {
    variant: shared ? "localShared" : "local",
    listener,
    target,
    command: `ssh -L ${bindArg}${localPort}:${target} ${sshTarget}`,
  };
}
