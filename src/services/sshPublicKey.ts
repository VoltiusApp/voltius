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
 */
const SSH_PUBLIC_KEY =
  /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[ \t]+[A-Za-z0-9+/]+={0,2}([ \t]+[^\r\n]*)?$/;

export function isValidSshPublicKey(value: string): boolean {
  return SSH_PUBLIC_KEY.test(value.trim());
}
