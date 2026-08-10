import i18n from "@/i18n";
import { getSecret } from "@/services/vault";
import { resolveConnectionCredentials } from "@/services/credentials";
import { sshExecCommand } from "@/services/ssh";
import { isValidSshPublicKey } from "@/services/sshPublicKey";
import { isSafeFilename, isSafeRelativeDir } from "@/services/sshKeyPath";
import type { Connection, SshKey } from "@/types";

/** POSIX single-quote escaping: close the quote, insert an escaped quote, reopen it. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export const DEFAULT_EXPORT_SCRIPT = `if test ! -e "$1";
then mkdir -p "$1";
chmod 700 "$1";
fi;
if test ! -e "$1/$2";
then touch "$1/$2";
chmod 600 "$1/$2";
fi;
printf "%s\n%s\n" "$3" "$4" >> "$1/$2";`;

export interface AddKeyToHostInput {
  sshKey: SshKey;
  connection: Connection;
  /** Directory holding the file, relative to the remote home. Default ".ssh". */
  location?: string;
  /** Default "authorized_keys". */
  filename?: string;
  /** The panel's Advanced box. MCP never passes one. */
  script?: string;
}

export async function addKeyToHost({
  sshKey,
  connection,
  location = ".ssh",
  filename = "authorized_keys",
  script = DEFAULT_EXPORT_SCRIPT,
}: AddKeyToHostInput): Promise<void> {
  // Here, not only in the MCP schema: api.keys.addToHost passes both straight
  // through, so the schema alone would leave the plugin route writing anywhere.
  if (!isSafeRelativeDir(location)) throw new Error(i18n.t("keychain.exportPanel.invalidLocationError"));
  if (!isSafeFilename(filename)) throw new Error(i18n.t("keychain.exportPanel.invalidFilenameError"));

  const pubKey = await getSecret(`key:${sshKey.id}:public`);
  if (!pubKey) throw new Error(i18n.t("keychain.exportPanel.publicKeyNotFoundError"));
  const trimmedPubKey = pubKey.trim();
  // printf writes this verbatim as the file's second line, so anything that is
  // not a real public key is attacker-chosen remote file content. Checked here,
  // not only at key_create, so keys stored before that rule existed are caught.
  // Reject rather than strip — this is key material, not a label.
  if (/[\r\n]/.test(trimmedPubKey)) throw new Error(i18n.t("keychain.exportPanel.multilinePublicKeyError"));
  if (!isValidSshPublicKey(trimmedPubKey)) {
    throw new Error(i18n.t("keychain.exportPanel.invalidPublicKeyError"));
  }

  const { username, password, privateKey, passphrase } = await resolveConnectionCredentials(connection);

  // Strip CR/LF: printf writes `comment` verbatim, so an unstripped newline in
  // a model-settable key name (key_create) would smuggle a second, attacker-
  // chosen line into authorized_keys under a name the approval prompt never shows.
  const label = (sshKey.name ?? "SSH").replace(/[\r\n]+/g, " ");
  const comment = `# ${label} Key by Voltius`;
  const command = `sh -c '${script}' sh ${shellQuote(location)} ${shellQuote(filename)} ${shellQuote(comment)} ${shellQuote(trimmedPubKey)}`;
  const result = await sshExecCommand({
    host: connection.host,
    port: connection.port,
    username,
    password,
    privateKey,
    passphrase,
    command,
  });
  if (result.exit_code !== 0) {
    const detail = result.stderr.trim();
    throw new Error(
      detail
        ? i18n.t("keychain.exportPanel.remoteCommandFailedError", { detail })
        : i18n.t("keychain.exportPanel.remoteCommandFailedUnknownError", { code: result.exit_code ?? "unknown" }),
    );
  }
}
