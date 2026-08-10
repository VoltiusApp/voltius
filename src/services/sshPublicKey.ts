/**
 * The one place an SSH public key's format is decided.
 *
 * A stored public half is written verbatim into a remote file by `addKeyToHost`,
 * and the script supplies the line break itself, so a single unvalidated line is
 * enough to plant a cron entry or a shell rc line. Anything that is not a real
 * "type base64 [comment]" key is refused — at creation, so it cannot be stored,
 * and again at deploy time, so keys stored before this rule existed are caught.
 *
 * Separators are [ \t] rather than \s: \s admits the newline this exists to keep
 * out. The key types are the ones the app generates (ed25519/ecdsa/rsa) plus the
 * remaining OpenSSH types a user can paste in.
 *
 * The comment tail is a DENY-list, not an allow-list: the appended line can land
 * in a file something interprets (~/.ssh/rc is run by sshd at every login), where
 * a comment carrying ; | & $ ` ( ) < > a quote or a backslash would be a command.
 * Everything else stays legal, including non-ASCII — real .pub comments carry
 * accented names, non-Latin hostnames, `user@host:2222`, `key=prod`. Globs and ~
 * are harmless as arguments to a command that does not exist. The first comment
 * character must be a non-space, so the pattern has no ambiguous split to
 * backtrack over.
 */
const SSH_PUBLIC_KEY =
  /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[ \t]+[A-Za-z0-9+/]+={0,2}([ \t]+[^\x00-\x20;|&$`<>()'"\\\x7f][^\x00-\x1f;|&$`<>()'"\\\x7f]*)?$/;

export function isValidSshPublicKey(value: string): boolean {
  return SSH_PUBLIC_KEY.test(value.trim());
}
