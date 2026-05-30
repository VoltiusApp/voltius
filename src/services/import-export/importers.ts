import { fromJSON, detectFormat } from "./formats";
import type { ConnectionExport, ExportBundle } from "./formats";
import { connectionsFromCSV } from "./parsers/csv";
import { connectionsFromMobaXterm, extractMobaXtermBundle } from "./parsers/mobaxterm";
import { bundleFromTermius, extractTermiusBundle } from "./parsers/termius";

export interface Importer {
  key: string;
  label: string;
  icon: string;
  sub: string;
  fileAccept: string;
  hint?: string;
  placeholder: string;
  parse(text: string): ExportBundle;
  /** Optional: one-step extraction from a locally-installed source app. */
  autoExtract?(): Promise<ExportBundle>;
}

function connectionsOnlyBundle(connections: ConnectionExport[]): ExportBundle {
  return { version: 1, exported_at: "", folders: [], connections, identities: [], keys: [], snippets: [], portForwardingRules: [] };
}

export const IMPORTERS: Importer[] = [
  {
    key: "voltius",
    label: "Voltius JSON",
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
    icon: "custom:mobaxterm",
    sub: "Local install · auto-decrypt",
    fileAccept: ".ini,.mxtsessions,.mobaconf,.txt",
    hint: "Reads and decrypts the local MobaXterm install directly — sessions and passwords, no master password needed (Windows only). You can also drop a MobaXterm.ini / .mxtsessions file (sessions only; passwords stay in the registry). SSH keys are not included — add them in Voltius and link them after importing.",
    placeholder: "Drop MobaXterm.ini here, or paste its contents…",
    parse: (text) => connectionsOnlyBundle(connectionsFromMobaXterm(text)),
    autoExtract: extractMobaXtermBundle,
  },
  {
    key: "termius",
    label: "Termius",
    icon: "simple-icons:termius",
    sub: "Local install · auto-extract",
    fileAccept: ".json",
    hint: "Reads and decrypts the local Termius database directly. Termius must be installed and logged in on this machine. Faithful import requires live extraction because legacy dumps do not include record metadata.",
    placeholder: "Use Auto Extract for Termius. Pasted legacy Termius dumps are not supported for faithful import.",
    parse: bundleFromTermius,
    autoExtract: extractTermiusBundle,
  },
];

export function parseImport(text: string): ExportBundle | "encrypted" {
  const detected = detectFormat(text.trim());
  if (detected === "voltius-encrypted") return "encrypted";
  if (detected === "json") return fromJSON(text);
  if (detected === "csv") return connectionsOnlyBundle(connectionsFromCSV(text));
  if (detected === "mobaxterm") return connectionsOnlyBundle(connectionsFromMobaXterm(text));
  if (detected === "termius") return bundleFromTermius(text);
  throw new Error("Could not detect format. Supported: Voltius JSON, CSV, MobaXterm.ini / .mxtsessions, or live Termius extraction.");
}
