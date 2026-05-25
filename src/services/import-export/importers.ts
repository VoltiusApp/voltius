import { fromJSON, detectFormat } from "./formats";
import type { ConnectionExport, ExportBundle } from "./formats";
import { connectionsFromCSV } from "./parsers/csv";
import { connectionsFromMobaXterm } from "./parsers/mobaxterm";

export interface Importer {
  key: string;
  label: string;
  icon: string;
  sub: string;
  fileAccept: string;
  hint?: string;
  placeholder: string;
  parse(text: string): ExportBundle;
}

function connectionsOnlyBundle(connections: ConnectionExport[]): ExportBundle {
  return { version: 1, exported_at: "", folders: [], connections, identities: [], keys: [], snippets: [], portForwardingRules: [] };
}

export const IMPORTERS: Importer[] = [
  {
    key: "voltius",
    label: "Voltius Backup",
    icon: "lucide:vault",
    sub: "JSON",
    fileAccept: ".json",
    hint: "Export from Voltius via Import / Export → Export → Download .json",
    placeholder: 'Paste Voltius JSON here, or drop a .json file…\n\n{ "version": 1, "connections": [...] }',
    parse: fromJSON,
  },
  {
    key: "csv",
    label: "CSV",
    icon: "lucide:table-2",
    sub: "Spreadsheet",
    fileAccept: ".csv,.txt",
    hint: "Any CSV with at least host and username columns. Tags are semicolon-separated.",
    placeholder: "Paste CSV here, or drop a file…\n\nname,host,port,username,auth_type,tags",
    parse: (text) => connectionsOnlyBundle(connectionsFromCSV(text)),
  },
  {
    key: "mobaxterm",
    label: "MobaXterm",
    icon: "lucide:monitor",
    sub: ".ini · .mxtsessions · .mobaconf",
    fileAccept: ".ini,.mxtsessions,.mobaconf,.txt",
    hint: "SSH keys are not included in MobaXterm exports — add them manually in Voltius and link them after importing.",
    placeholder: "Drop MobaXterm.ini here, or paste its contents…",
    parse: (text) => connectionsOnlyBundle(connectionsFromMobaXterm(text)),
  },
];

export function parseImport(text: string): ExportBundle | "encrypted" {
  const detected = detectFormat(text.trim());
  if (detected === "voltius-encrypted") return "encrypted";
  if (detected === "json") return fromJSON(text);
  if (detected === "csv") return connectionsOnlyBundle(connectionsFromCSV(text));
  if (detected === "mobaxterm") return connectionsOnlyBundle(connectionsFromMobaXterm(text));
  throw new Error("Could not detect format. Supported: Voltius JSON, CSV, MobaXterm.ini / .mxtsessions.");
}
