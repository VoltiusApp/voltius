import type { PortMapping } from "./types";

export type PortKind = "http" | "tcp" | "inert";

export interface ClassifiedPort {
  port: PortMapping;
  kind: PortKind;
  scheme: "http" | "https";
  full: string;
  short: string;
  inertReason: string | null;
}

const HTTP_PORTS = new Set([80, 3000, 3001, 4200, 5000, 5173, 7000, 8000, 8008, 8080, 8081, 8888, 9000, 9090]);
const HTTPS_PORTS = new Set([443, 8443]);

function classify(port: PortMapping): ClassifiedPort {
  const full = port.host_port
    ? `${port.host_port}→${port.container_port}/${port.protocol}`
    : `${port.container_port}/${port.protocol}`;

  if (port.protocol !== "tcp") {
    return { port, kind: "inert", scheme: "http", full, short: full, inertReason: "UDP ports can't be opened from here" };
  }
  if (port.host_port == null) {
    return { port, kind: "inert", scheme: "http", full, short: full, inertReason: "Port is not published to the host" };
  }
  const https = HTTPS_PORTS.has(port.host_port);
  const web = https || HTTP_PORTS.has(port.host_port);
  return {
    port,
    kind: web ? "http" : "tcp",
    scheme: https ? "https" : "http",
    full,
    short: String(port.host_port),
    inertReason: null,
  };
}

const RANK: Record<PortKind, number> = { http: 0, tcp: 1, inert: 2 };

export function classifyPorts(ports: PortMapping[]): ClassifiedPort[] {
  return ports
    .map(classify)
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.port.host_port ?? a.port.container_port) - (b.port.host_port ?? b.port.container_port));
}

export function actionFor(kind: PortKind): "browser" | "copy" | null {
  if (kind === "http") return "browser";
  if (kind === "tcp") return "copy";
  return null;
}
