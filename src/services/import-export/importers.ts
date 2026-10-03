import i18n from "@/i18n";
import { decryptText, fromJSON, detectFormat, importedBundle } from "./formats";
import type { ImportOutcome } from "./formats";
import { connectionsFromCSV } from "./parsers/csv";
import { connectionsFromMobaXterm, extractMobaXtermBundle } from "./parsers/mobaxterm";
import { bundleFromTermius, extractTermiusBundle } from "./parsers/termius";
import { bundleFromZoc } from "./parsers/zoc";
import { bundleFromPutty, extractPuttyBundle } from "./parsers/putty";
import { bundleFromSecureCrt, extractSecureCrtBundle } from "./parsers/securecrt";

export interface Importer {
  key: string;
  label: string;
  icon: string;
  /** i18n keys, translated where rendered. */
  subKey: string;
  fileAccept: string;
  hintKey?: string;
  placeholderKey: string;
  parse(text: string): ImportOutcome | Promise<ImportOutcome>;
  /** Optional: one-step extraction from a locally-installed source app. */
  autoExtract?(): Promise<ImportOutcome>;
  extractFromFolder?(dir: string): Promise<ImportOutcome>;
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
  {
    key: "securecrt",
    label: "SecureCRT",
    icon: "custom:securecrt",
    subKey: "importExport.importers.securecrt.sub",
    fileAccept: ".ini,.xml",
    hintKey: "importExport.importers.securecrt.hint",
    placeholderKey: "importExport.importers.securecrt.placeholder",
    parse: bundleFromSecureCrt,
    autoExtract: () => extractSecureCrtBundle(),
    extractFromFolder: extractSecureCrtBundle,
  },
];

export async function parseImport(text: string): Promise<ImportOutcome> {
  const detected = detectFormat(text.trim());
  if (detected === "voltius-encrypted") {
    return { kind: "backup", unlock: async (password) => fromJSON(await decryptText(text, password)) };
  }
  const importer = IMPORTERS.find((i) => i.key === (detected === "json" ? "voltius" : detected));
  if (!importer) throw new Error(i18n.t("common.error.couldNotDetectFormat"));
  return importer.parse(text);
}
