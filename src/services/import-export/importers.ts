import i18n from "@/i18n";
import { fromJSON, detectFormat, importedBundle } from "./formats";
import type { ExportBundle } from "./formats";
import { connectionsFromCSV } from "./parsers/csv";
import { connectionsFromMobaXterm, extractMobaXtermBundle } from "./parsers/mobaxterm";
import { bundleFromTermius, extractTermiusBundle } from "./parsers/termius";
import { bundleFromZoc } from "./parsers/zoc";
import { bundleFromPutty, extractPuttyBundle } from "./parsers/putty";

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
    parse: (text) => importedBundle({ connections: connectionsFromCSV(text) }),
  },
  {
    key: "mobaxterm",
    label: "MobaXterm",
    icon: "custom:mobaxterm",
    subKey: "importExport.importers.mobaxterm.sub",
    fileAccept: ".ini,.mxtsessions,.mobaconf,.txt",
    hintKey: "importExport.importers.mobaxterm.hint",
    placeholderKey: "importExport.importers.mobaxterm.placeholder",
    parse: (text) => importedBundle({ connections: connectionsFromMobaXterm(text) }),
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
  {
    key: "zoc",
    label: "ZOC Terminal",
    icon: "custom:zoc",
    subKey: "importExport.importers.zoc.sub",
    fileAccept: ".zhd,.txt",
    hintKey: "importExport.importers.zoc.hint",
    placeholderKey: "importExport.importers.zoc.placeholder",
    parse: bundleFromZoc,
  },
  {
    key: "putty",
    label: "PuTTY",
    icon: "custom:putty",
    subKey: "importExport.importers.putty.sub",
    fileAccept: ".reg,.txt",
    hintKey: "importExport.importers.putty.hint",
    placeholderKey: "importExport.importers.putty.placeholder",
    parse: bundleFromPutty,
    autoExtract: extractPuttyBundle,
  },
];

export function parseImport(text: string): ExportBundle | "encrypted" {
  const detected = detectFormat(text.trim());
  if (detected === "voltius-encrypted") return "encrypted";
  const importer = detected && IMPORTERS.find((i) => i.key === (detected === "json" ? "voltius" : detected));
  if (!importer) throw new Error(i18n.t("common.error.couldNotDetectFormat"));
  return importer.parse(text);
}
