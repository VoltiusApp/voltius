import i18n from "@/i18n";
import type { ConnectionExport } from "../formats";

const CSV_HEADERS = ["name", "host", "port", "username", "auth_type", "tags"];

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function connectionsToCSV(connections: ConnectionExport[]): string {
  const rows: string[][] = [CSV_HEADERS];
  for (const c of connections) {
    rows.push([c.name ?? "", c.host ?? "", String(c.port ?? 0), c.username ?? "", c.auth_type ?? "", c.tags.join(";")]);
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { result.push(""); break; }
    if (line[i] === '"') {
      let value = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { value += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { value += line[i++]; }
      }
      result.push(value);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { result.push(line.slice(i)); break; }
      result.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return result;
}

export function connectionsFromCSV(text: string): ConnectionExport[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map((h) => h.toLowerCase().trim());
  const col = (name: string) => headers.indexOf(name);

  const hostIdx = col("host") >= 0 ? col("host") : col("hostname");
  const usernameIdx = col("username") >= 0 ? col("username") : col("user");
  if (hostIdx === -1 || usernameIdx === -1) {
    throw new Error(i18n.t("common.error.csvMissingColumns"));
  }

  const connections: ConnectionExport[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    const host = row[hostIdx]?.trim();
    const username = row[usernameIdx]?.trim();
    if (!host || !username) continue;
    connections.push({
      name: col("name") >= 0 ? row[col("name")]?.trim() || undefined : undefined,
      host,
      port: col("port") >= 0 ? parseInt(row[col("port")], 10) || 22 : 22,
      username,
      auth_type: (col("auth_type") >= 0 && row[col("auth_type")]?.trim() === "key") ? "key" : "password",
      tags: col("tags") >= 0 && row[col("tags")]?.trim()
        ? row[col("tags")].trim().split(";").map((t) => t.trim()).filter(Boolean)
        : [],
    });
  }
  return connections;
}
