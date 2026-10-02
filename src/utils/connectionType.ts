import type { Connection } from "@/types";

export function isFileOnlyProtocol(c: Pick<Connection, "connection_type">): boolean {
  return c.connection_type === "ftp" || c.connection_type === "webdav";
}

export function protocolLabel(c: Pick<Connection, "connection_type" | "ftp_secure">): string {
  switch (c.connection_type) {
    case "serial": return "SERIAL";
    case "ftp": return c.ftp_secure ? "FTPS" : "FTP";
    case "webdav": return "WebDAV";
    default: return "SSH";
  }
}

export interface WebdavTarget {
  url: string;
  host: string;
  port: number;
  secure: boolean;
}

/** Mirrors `DavBase::parse` in src-tauri/src/webdav/paths.rs. */
export function parseWebdavUrl(raw: string): WebdavTarget | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || u.username || u.password || u.search || u.hash || raw.includes("?") || raw.includes("#")) return null;
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  const secure = u.protocol === "https:";
  return {
    url: u.toString(),
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: u.port ? Number(u.port) : secure ? 443 : 80,
    secure,
  };
}
