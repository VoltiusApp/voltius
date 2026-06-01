export function connectionDisplayName(c: {
  name?: string;
  username?: string;
  host?: string;
  port?: number;
  connection_type?: string;
  serial_port?: string;
}): string {
  if (c.connection_type === "serial") {
    return c.name?.trim() || c.serial_port || "Serial Device";
  }
  return c.name?.trim() || `${c.username ?? ""}@${c.host ?? ""}:${c.port ?? ""}`;
}
