import type { ConnectionExport } from "../formats";

// INI file format. Each [Bookmarks_N] section has SubRep=FolderName, then
// session lines: Name=#TYPE#flags%field1%field2%... SSH is type 109.
// SSH fields: [0]=flags [1]=host [2]=port [3]=username [4]=auth (3=key, else password)
const MOBAXTERM_SSH_TYPE = 109;

export function connectionsFromMobaXterm(text: string): ConnectionExport[] {
  const connections: ConnectionExport[] = [];
  let currentFolder: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("[") && line.endsWith("]")) {
      currentFolder = undefined;
      continue;
    }

    if (line.startsWith("SubRep=")) {
      const folder = line.slice(7).trim().replace(/\\/g, "/");
      currentFolder = folder || undefined;
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const name = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();

    const typeMatch = value.match(/^#(\d+)#/);
    if (!typeMatch) continue;
    if (parseInt(typeMatch[1], 10) !== MOBAXTERM_SSH_TYPE) continue;

    const fields = value.slice(typeMatch[0].length).split("%");
    // fields[0]=flags, [1]=host, [2]=port, [3]=username, [4]=auth
    const host = fields[1]?.trim();
    const port = parseInt(fields[2] ?? "22", 10) || 22;
    const username = fields[3]?.trim();
    if (!host || !username) continue;

    const auth_type: "key" | "password" = fields[4]?.trim() === "3" ? "key" : "password";

    connections.push({
      name,
      host,
      port,
      username,
      auth_type,
      tags: currentFolder ? [currentFolder] : [],
    });
  }

  return connections;
}
