export type TeamSecretType =
  | "connection_password"
  | "connection_key"
  | "connection_passphrase"
  | "identity_password"
  | "key_private"
  | "key_public"
  | "key_passphrase";

export interface TeamSecretKeyParts {
  secretId: string;
  objectId: string;
  secretType: TeamSecretType;
}

export function teamSecretFromLocalKey(localKey: string): TeamSecretKeyParts | null {
  const passwordMatch = /^password:(.+)$/.exec(localKey);
  if (passwordMatch) {
    return { secretId: localKey, objectId: passwordMatch[1], secretType: "connection_password" };
  }

  // The passphrase for a connection's inline private key. Distinct from
  // `key:<key_id>:passphrase`, which belongs to a keychain key.
  const connectionPassphraseMatch = /^passphrase:(.+)$/.exec(localKey);
  if (connectionPassphraseMatch) {
    return {
      secretId: localKey,
      objectId: connectionPassphraseMatch[1],
      secretType: "connection_passphrase",
    };
  }

  const connectionKeyMatch = /^key:([^:]+)$/.exec(localKey);
  if (connectionKeyMatch) {
    return { secretId: localKey, objectId: connectionKeyMatch[1], secretType: "connection_key" };
  }

  const identityPasswordMatch = /^identity:(.+):password$/.exec(localKey);
  if (identityPasswordMatch) {
    return { secretId: localKey, objectId: identityPasswordMatch[1], secretType: "identity_password" };
  }

  const keyPartMatch = /^key:(.+):(private|public|passphrase)$/.exec(localKey);
  if (keyPartMatch) {
    return {
      secretId: localKey,
      objectId: keyPartMatch[1],
      secretType: `key_${keyPartMatch[2]}` as TeamSecretType,
    };
  }

  return null;
}

export function localSecretKeyFromTeamSecret(objectId: string, secretType: string): string | null {
  switch (secretType) {
    case "connection_password": return `password:${objectId}`;
    case "connection_key": return `key:${objectId}`;
    case "connection_passphrase": return `passphrase:${objectId}`;
    case "identity_password": return `identity:${objectId}:password`;
    case "key_private": return `key:${objectId}:private`;
    case "key_public": return `key:${objectId}:public`;
    case "key_passphrase": return `key:${objectId}:passphrase`;
    default: return null;
  }
}
