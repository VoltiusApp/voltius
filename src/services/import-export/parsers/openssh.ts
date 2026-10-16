import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import { importedBundle } from "../formats";
import type { ConnectionExport, ExportBundle, ImportNotice, JumpHostExport } from "../formats";
import { parseSshConfig, type IncludeResolver, type IncludedFile, type SshConfigHost } from "@/services/sshConfig/parse";
import { connectionFieldsOf, identityPaths, jumpHostsOf, keyExportsOf, splitSupported } from "@/services/sshConfig/hostFields";

export function isOpensshConfig(text: string): boolean {
  return /^\s*(host|match|include)\s+\S/im.test(text) && /^\s*(hostname|user|port|identityfile|proxyjump)(\s|=)/im.test(text);
}

export interface OpensshFiles {
  config: string | null;
  configError: string | null;
  includes: Record<string, IncludedFile[]>;
  keys: Record<string, { privateKey: string | null; publicKey: string | null; privateReadable: boolean }>;
}

// "probe" derives the public half and reports whether the private key is readable, without sending it.
export type PrivateKeyRead = "read" | "probe";

export const readOpensshFiles = (keyPaths?: string[], privateKeys: PrivateKeyRead = "read") =>
  invoke<OpensshFiles>("openssh_config_read", { keyPaths: keyPaths ?? null, privateKeys });

export const includeResolver = (files: OpensshFiles): IncludeResolver => (pattern) => files.includes[pattern] ?? null;

export function bundleFromOpenssh(text: string, files?: OpensshFiles): ExportBundle {
  const parsed = parseSshConfig(text, files && includeResolver(files));
  const { hosts, skipped } = splitSupported(parsed);
  const { keys, keyRefs, eidOf: keyEid } = keyExportsOf(identityPaths(hosts), files);
  const eidOf = (host: SshConfigHost) => `c${hosts.indexOf(host)}`;
  const connections: ConnectionExport[] = hosts.map((h) => ({
    _eid: eidOf(h),
    ...connectionFieldsOf(h),
    tags: [],
    ...(h.identityFile && { _key_eid: keyEid(h.identityFile) }),
    ...(h.proxyJump && { jump_hosts: jumpHostsOf(h.proxyJump, parsed.hosts, (ref): Pick<JumpHostExport, "_connection_eid"> => (ref ? { _connection_eid: eidOf(ref) } : {})) }),
  }));
  const notices = skipped.map(({ alias, reason }): ImportNotice => ({ kind: reason, text: reason === "proxyCommand" ? `Host ${alias}` : alias }));
  return importedBundle({ connections, keys, keyRefs, notices });
}

export const parseOpensshFiles = (files: OpensshFiles) => parseSshConfig(files.config ?? "", includeResolver(files));

export async function extractOpensshBundle(): Promise<ExportBundle> {
  const files = await readOpensshFiles();
  if (files.configError) throw new Error(i18n.t("importExport.importers.openssh.unreadable", { reason: files.configError }));
  if (files.config === null) throw new Error(i18n.t("importExport.importers.openssh.notFound"));
  const { keys } = await readOpensshFiles(identityPaths(parseOpensshFiles(files).hosts));
  return bundleFromOpenssh(files.config, { ...files, keys });
}
