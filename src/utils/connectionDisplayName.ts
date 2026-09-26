import i18n from "@/i18n";

export function connectionDisplayName(c: {
  name?: string;
  username?: string;
  host?: string;
  port?: number;
  connection_type?: string;
  serial_port?: string;
}): string {
  if (c.connection_type === "serial") {
    return c.name?.trim() || c.serial_port || i18n.t("common.serialDevice");
  }
  return c.name?.trim() || `${c.username ?? ""}@${c.host ?? ""}:${c.port ?? ""}`;
}
