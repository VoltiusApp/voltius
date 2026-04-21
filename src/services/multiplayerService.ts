import { invoke } from "@tauri-apps/api/core";
import { getVaultKey } from "@/services/vault";
import * as teamService from "@/services/teamService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActiveSession {
  id: string;
  connection_name: string;
  host_user_id: string;
  host_public_key: string;
  visibility: string;
  created_at: string;
  participant_count: number;
}

export interface Participant {
  user_id: string;
  display_name: string;
}

export interface SessionCallbacks {
  onOutput: (data: Uint8Array) => void;
  onInput: (data: Uint8Array) => void;
  onControlUpdate: (holderId: string, requesterId: string | null) => void;
  onParticipantJoined: (participant: Participant) => void;
  onParticipantLeft: (userId: string) => void;
  onParticipantList: (participants: Participant[]) => void;
  onSessionEnded: () => void;
}

// ─── WebCrypto AES-GCM helpers ────────────────────────────────────────────────

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function importSessionKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(rawBytes), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptData(key: CryptoKey, plaintext: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plaintext));
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...out));
}

export async function decryptData(key: CryptoKey, b64: string): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(ciphertext));
  return new Uint8Array(plaintext);
}

// ─── Private key derivation ───────────────────────────────────────────────────

let _cachedPrivateKey: string | null = null;
let _cachedPublicKey: string | null = null;

export async function getMyX25519Keypair(): Promise<{ privateKey: string; publicKey: string }> {
  if (_cachedPrivateKey && _cachedPublicKey) {
    return { privateKey: _cachedPrivateKey, publicKey: _cachedPublicKey };
  }
  const encKey = getVaultKey();
  if (!encKey) throw new Error("Vault is locked");
  const result = await invoke<{ public_key: string; private_key: string }>(
    "derive_x25519_keypair",
    { encKey },
  );
  _cachedPrivateKey = result.private_key;
  _cachedPublicKey = result.public_key;
  return { privateKey: result.private_key, publicKey: result.public_key };
}

export function clearKeypairCache() {
  _cachedPrivateKey = null;
  _cachedPublicKey = null;
}

// ─── Session key operations ───────────────────────────────────────────────────

export async function wrapSessionKeyForUser(
  sessionKeyBytes: Uint8Array,
  recipientPublicKeyB64: string,
): Promise<string> {
  const { privateKey } = await getMyX25519Keypair();
  return invoke<string>("x25519_wrap_key", {
    myPrivateKeyB64: privateKey,
    recipientPublicKeyB64: recipientPublicKeyB64,
    plaintext: Array.from(sessionKeyBytes),
  });
}

export async function unwrapSessionKey(
  wrappedKeyB64: string,
  senderPublicKeyB64: string,
): Promise<Uint8Array> {
  const { privateKey } = await getMyX25519Keypair();
  const bytes = await invoke<number[]>("x25519_unwrap_key", {
    myPrivateKeyB64: privateKey,
    senderPublicKeyB64,
    wrappedB64: wrappedKeyB64,
  });
  return new Uint8Array(bytes);
}

// ─── Server API ───────────────────────────────────────────────────────────────

export async function listActiveSessions(): Promise<ActiveSession[]> {
  const serverUrl = await teamService.getServerUrlValue();
  if (!serverUrl) return [];
  const jwt = await teamService.getJwtToken();
  if (!jwt) return [];
  const res = await fetch(`${serverUrl}/v1/terminal-sessions`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Create a vault-based session (E2EE per-user key wrapping).
 * Members of the selected vaults can join; optionally filtered by role.
 */
export async function createVaultSession(
  vaultIds: string[],
  allowedRoles: string[],
  connectionName: string,
  members: teamService.TeamMember[],
): Promise<{ sessionId: string; sessionKey: CryptoKey; sessionKeyBytes: Uint8Array }> {
  const { publicKey } = await getMyX25519Keypair();
  await teamService.updatePublicKey(publicKey);

  const sessionKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessionKey = await importSessionKey(sessionKeyBytes);

  // Deduplicate members by user_id across multiple vaults
  const uniqueMembers = Array.from(
    new Map(members.map((m) => [m.user_id, m])).values(),
  );

  const participantKeys = await Promise.all(
    uniqueMembers.map(async (member) => ({
      user_id: member.user_id,
      wrapped_key: await wrapSessionKeyForUser(sessionKeyBytes, member.public_key),
    })),
  );

  const serverUrl = await teamService.getServerUrlValue();
  if (!serverUrl) throw new Error("Not connected to server");
  const jwt = await teamService.getJwtToken();
  if (!jwt) throw new Error("Not authenticated");

  const res = await fetch(`${serverUrl}/v1/terminal-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vault_ids: vaultIds,
      connection_name: connectionName,
      visibility: "vault",
      participant_keys: participantKeys,
      allowed_roles: allowedRoles,
    }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  const { session_id } = await res.json();

  return { sessionId: session_id, sessionKey, sessionKeyBytes };
}

/**
 * Create an invite-link session — raw session key stored server-side (no E2EE per-user wrapping).
 * Anyone with the invite token can join, regardless of vault membership.
 */
export async function createInviteLinkSession(
  connectionName: string,
): Promise<{ sessionId: string; sessionKey: CryptoKey; inviteToken: string }> {
  const serverUrl = await teamService.getServerUrlValue();
  if (!serverUrl) throw new Error("Not connected to server");
  const jwt = await teamService.getJwtToken();
  if (!jwt) throw new Error("Not authenticated");

  const sessionKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessionKey = await importSessionKey(sessionKeyBytes);
  const sessionKeyB64 = btoa(String.fromCharCode(...sessionKeyBytes));

  const res = await fetch(`${serverUrl}/v1/terminal-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connection_name: connectionName,
      visibility: "invite_link",
      session_key_bytes: sessionKeyB64,
    }),
  });
  if (!res.ok) throw new Error(`Failed to create invite link session: ${res.status}`);
  const { session_id, invite_token } = await res.json();

  return { sessionId: session_id, sessionKey, inviteToken: invite_token as string };
}

export async function getMySessionKey(
  sessionId: string,
  inviteToken?: string,
): Promise<{ sessionKey: CryptoKey; hostPublicKey: string }> {
  const serverUrl = await teamService.getServerUrlValue();
  if (!serverUrl) throw new Error("Not connected to server");
  const jwt = await teamService.getJwtToken();
  if (!jwt) throw new Error("Not authenticated");

  const url = inviteToken
    ? `${serverUrl}/v1/terminal-sessions/${sessionId}/my-key?invite_token=${encodeURIComponent(inviteToken)}`
    : `${serverUrl}/v1/terminal-sessions/${sessionId}/my-key`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`Failed to get session key: ${res.status}`);
  const { wrapped_key, raw_key, host_public_key } = await res.json();

  if (raw_key) {
    const keyBytes = Uint8Array.from(atob(raw_key as string), (c) => c.charCodeAt(0));
    const sessionKey = await importSessionKey(keyBytes);
    return { sessionKey, hostPublicKey: host_public_key as string };
  }

  const { publicKey } = await getMyX25519Keypair();
  await teamService.updatePublicKey(publicKey);

  const sessionKeyBytes = await unwrapSessionKey(wrapped_key as string, host_public_key as string);
  const sessionKey = await importSessionKey(sessionKeyBytes);
  return { sessionKey, hostPublicKey: host_public_key as string };
}

export async function endMultiplayerSession(sessionId: string): Promise<void> {
  const serverUrl = await teamService.getServerUrlValue();
  if (!serverUrl) throw new Error("Not connected to server");
  const jwt = await teamService.getJwtToken();
  if (!jwt) throw new Error("Not authenticated");
  await fetch(`${serverUrl}/v1/terminal-sessions/${sessionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

// ─── WebSocket connection ─────────────────────────────────────────────────────

// ─── Per-session SSH output buffer (pre-share scrollback) ────────────────────

const MAX_BUFFER_BYTES = 64 * 1024; // 64 KB per session

interface OutputBuffer { chunks: Uint8Array[]; totalBytes: number; }
const sshOutputBuffers = new Map<string, OutputBuffer>();

export function appendSshOutputBuffer(sessionId: string, data: Uint8Array): void {
  let buf = sshOutputBuffers.get(sessionId);
  if (!buf) { buf = { chunks: [], totalBytes: 0 }; sshOutputBuffers.set(sessionId, buf); }
  buf.chunks.push(data);
  buf.totalBytes += data.length;
  // Trim oldest chunks if over budget
  while (buf.totalBytes > MAX_BUFFER_BYTES && buf.chunks.length > 0) {
    buf.totalBytes -= buf.chunks.shift()!.length;
  }
}

export function drainSshOutputBuffer(sessionId: string): Uint8Array | null {
  const buf = sshOutputBuffers.get(sessionId);
  sshOutputBuffers.delete(sessionId);
  if (!buf || buf.chunks.length === 0) return null;
  const out = new Uint8Array(buf.totalBytes);
  let offset = 0;
  for (const chunk of buf.chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

// ─── WebSocket relay ──────────────────────────────────────────────────────────

export interface MultiplayerConnection {
  sendOutput: (data: Uint8Array) => Promise<void>;
  sendInput: (data: Uint8Array) => Promise<void>;
  requestControl: () => void;
  grantControl: (targetUserId: string) => void;
  revokeControl: () => void;
  close: () => void;
}

export function openWebSocket(
  serverUrl: string,
  sessionId: string,
  jwt: string,
  displayName: string,
  sessionKey: CryptoKey,
  callbacks: SessionCallbacks,
  inviteToken?: string,
  initialSnapshot?: Uint8Array,
): MultiplayerConnection {
  let wsUrl = serverUrl
    .replace(/^https?/, (m) => (m === "https" ? "wss" : "ws"))
    + `/v1/terminal-sessions/${sessionId}/ws`
    + `?token=${encodeURIComponent(jwt)}&display_name=${encodeURIComponent(displayName)}`;

  if (inviteToken) {
    wsUrl += `&invite_token=${encodeURIComponent(inviteToken)}`;
  }

  const ws = new WebSocket(wsUrl);

  // Send the pre-share terminal snapshot as the first output message so the
  // server stores it in history and late joiners see it from the beginning.
  ws.onopen = async () => {
    if (initialSnapshot && initialSnapshot.length > 0) {
      const encrypted = await encryptData(sessionKey, initialSnapshot);
      ws.send(JSON.stringify({ type: "output", data: encrypted }));
    }
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      switch (msg.type) {
        case "output": {
          const decrypted = await decryptData(sessionKey, msg.data as string);
          callbacks.onOutput(decrypted);
          break;
        }
        case "input": {
          const decrypted = await decryptData(sessionKey, msg.data as string);
          callbacks.onInput(decrypted);
          break;
        }
        case "control_update":
          callbacks.onControlUpdate(msg.holder as string, (msg.requester as string | null) ?? null);
          break;
        case "participant_joined":
          callbacks.onParticipantJoined({ user_id: msg.user_id as string, display_name: msg.display_name as string });
          break;
        case "participant_left":
          callbacks.onParticipantLeft(msg.user_id as string);
          break;
        case "participant_list":
          callbacks.onParticipantList(msg.participants as Participant[]);
          break;
        case "session_ended":
          callbacks.onSessionEnded();
          break;
      }
    } catch {
      // Ignore parse errors
    }
  };

  const send = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  };

  return {
    sendOutput: async (data) => {
      const encrypted = await encryptData(sessionKey, data);
      send({ type: "output", data: encrypted });
    },
    sendInput: async (data) => {
      const encrypted = await encryptData(sessionKey, data);
      send({ type: "input", data: encrypted });
    },
    requestControl: () => send({ type: "request_control" }),
    grantControl: (targetUserId) => send({ type: "grant_control", target_user_id: targetUserId }),
    revokeControl: () => send({ type: "revoke_control" }),
    close: () => ws.close(),
  };
}
