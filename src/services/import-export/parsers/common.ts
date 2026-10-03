import type { ConnectionExport, FolderExport } from "../formats";

export interface SerialSettings {
  port: string;
  baud: number;
  dataBits: number;
  parity: "none" | "odd" | "even";
  stopBits: number;
  rtsCts: boolean;
  xonXoff: boolean;
}

export function serialConnection(name: string | undefined, notes: string | undefined, s?: SerialSettings): ConnectionExport {
  return {
    name,
    tags: [],
    connection_type: "serial",
    ...(s && {
      serial_port: s.port,
      serial_baud: s.baud,
      serial_data_bits: s.dataBits,
      serial_parity: s.parity,
      serial_stop_bits: s.stopBits,
      serial_flow_control: s.rtsCts ? "rts-cts" : s.xonXoff ? "xon-xoff" : "none",
    }),
    ...(notes && { notes }),
  };
}

export function pruneUnusedFolders(folders: FolderExport[], connections: ConnectionExport[]): FolderExport[] {
  const parentOf = new Map(folders.map((f) => [f._eid, f.parent_folder_eid]));
  const keep = new Set<string>();
  for (const c of connections) {
    for (let eid = c._folder_eid; eid && !keep.has(eid); eid = parentOf.get(eid)) keep.add(eid);
  }
  return folders.filter((f) => keep.has(f._eid));
}
