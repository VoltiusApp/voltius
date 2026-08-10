import i18n from "@/i18n";
import { getSecret } from "@/services/vault";
import { resolveConnectionCredentials } from "@/services/credentials";
import { sshExecCommand } from "@/services/ssh";
import type { Connection, SshKey } from "@/types";

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

  const { username, password, privateKey, passphrase } = await resolveConnectionCredentials(connection);

  const label = sshKey.name ?? "SSH";
  const comment = `# ${label} Key by Voltius`;
  const command = `sh -c '${script}' sh '${location}' '${filename}' '${comment}' '${pubKey.trim()}'`;
  await sshExecCommand({
    host: connection.host,
    port: connection.port,
    username,
    password,
    privateKey,
    passphrase,
    command,
  });
}
