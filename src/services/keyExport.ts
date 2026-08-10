import i18n from "@/i18n";
import { getSecret } from "@/services/vault";
import { resolveConnectionCredentials } from "@/services/credentials";
import { sshExecCommand } from "@/services/ssh";
import type { Connection, SshKey } from "@/types";

/** POSIX single-quote escaping: close the quote, insert an escaped quote, reopen it. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export const DEFAULT_EXPORT_SCRIPT = `if test ! -e $1;
then mkdir -p $1;
chmod 700 $1;
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
  const pubKey = await getSecret(`key:${sshKey.id}:public`);
  if (!pubKey) throw new Error(i18n.t("keychain.exportPanel.publicKeyNotFoundError"));
  const trimmedPubKey = pubKey.trim();
  // A real SSH public key is one line ("type base64 [comment]"). A multi-line
  // value only exists if key_create accepted an unvalidated one; printf writes
  // it verbatim, so it could smuggle a second authorized_keys line under a key
  // the approval prompt shows only by name. Reject rather than strip — this
  // is key material, not a label, and silently mangling it is worse.
  if (/[\r\n]/.test(trimmedPubKey)) throw new Error(i18n.t("keychain.exportPanel.multilinePublicKeyError"));

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
