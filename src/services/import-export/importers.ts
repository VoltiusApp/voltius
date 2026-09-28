import i18n from "@/i18n";
import { fromJSON, detectFormat } from "./formats";
import type { ConnectionExport, ExportBundle } from "./formats";
import { connectionsFromCSV } from "./parsers/csv";
import { connectionsFromMobaXterm, extractMobaXtermBundle } from "./parsers/mobaxterm";
import { bundleFromTermius, extractTermiusBundle } from "./parsers/termius";

export interface Importer {
  key: string;
  label: string;
  icon: string;
  /** i18n keys, translated where rendered. */
  subKey: string;
  fileAccept: string;
  hintKey?: string;
  placeholderKey: string;
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
    icon: "lucide:braces",
    subKey: "importExport.importers.voltius.sub",
    fileAccept: ".json",
    placeholderKey: "importExport.importers.voltius.placeholder",
    parse: fromJSON,
  },
  {
    key: "csv",
    label: "CSV",
    icon: "lucide:table-2",
    subKey: "importExport.importers.csv.sub",
    fileAccept: ".csv,.txt",
    placeholderKey: "importExport.importers.csv.placeholder",
    parse: (text) => connectionsOnlyBundle(connectionsFromCSV(text)),
  },
  {
    key: "mobaxterm",
    label: "MobaXterm",
    icon: "custom:mobaxterm",
    subKey: "importExport.importers.mobaxterm.sub",
    fileAccept: ".ini,.mxtsessions,.mobaconf,.txt",
    hintKey: "importExport.importers.mobaxterm.hint",
    placeholderKey: "importExport.importers.mobaxterm.placeholder",
    parse: (text) => connectionsOnlyBundle(connectionsFromMobaXterm(text)),
    autoExtract: extractMobaXtermBundle,
  },
  {
    key: "termius",
    label: "Termius",
    icon: "simple-icons:termius",
    subKey: "importExport.importers.termius.sub",
    fileAccept: ".json",
    hintKey: "importExport.importers.termius.hint",
    placeholderKey: "importExport.importers.termius.placeholder",
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
  throw new Error(i18n.t("common.error.couldNotDetectFormat"));
}
