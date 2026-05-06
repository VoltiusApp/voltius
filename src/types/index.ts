export type AuthType = "password" | "key";

export interface Folder {
  id: string;
  name: string;
  created_at: string;
  parent_folder_id?: string;
  object_type: string;
  vault_id?: string;
  color?: string;
  icon?: string;
  updated_at: string;
  deleted_at?: string;
  clocks: Record<string, string>;
}

export interface FolderFormData {
  name: string;
  parent_folder_id?: string;
  object_type: string;
  vault_id?: string;
  color?: string;
  icon?: string;
}

export interface SshKey {
  id: string;
  name?: string;
  key_type?: string;
  tags: string[];
  created_at: string;
  folder_id?: string;
  vault_id?: string;
  pinned?: boolean;
  updated_at: string;
  deleted_at?: string;
  clocks: Record<string, string>;
}

export interface SshKeyFormData {
  name?: string;
  key_type?: string;
  tags: string[];
  folder_id?: string;
  vault_id?: string;
  pinned?: boolean;
}

export interface Identity {
  id: string;
  name?: string;
  username: string;
  key_id?: string;
  tags: string[];
  created_at: string;
  folder_id?: string;
  vault_id?: string;
  pinned?: boolean;
  updated_at: string;
  deleted_at?: string;
  clocks: Record<string, string>;
}

export interface IdentityFormData {
  name?: string;
  username: string;
  key_id?: string;
  tags: string[];
  folder_id?: string;
  vault_id?: string;
  pinned?: boolean;
}

export interface JumpHost {
  id: string;
  connection_id: string;
  host: string;
  port: number;
  username: string;
  identity_id?: string;
}

export interface EnvVar {
  id: string;
  key: string;
  value: string;
}

export interface Connection {
  id: string;
  name?: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  tags: string[];
  created_at: string;
  last_used_at: string | null;
  distro?: string;
  identity_id?: string;
  folder_id?: string;
  vault_id?: string;
  jump_hosts?: JumpHost[];
  env_vars?: EnvVar[];
  agent_forwarding?: boolean;
  pre_command?: string;
  post_command?: string;
  terminal_encoding?: string;
  pinned?: boolean;
  ping_disabled?: boolean;
  connection_type?: "ssh" | "serial";
  serial_port?: string;
  serial_baud?: number;
  serial_data_bits?: number;
  serial_parity?: string;
  serial_stop_bits?: number;
  serial_flow_control?: string;
  updated_at: string;
  deleted_at?: string;
  clocks: Record<string, string>;
}

export interface ConnectionFormData {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  auth_type?: AuthType;
  tags: string[];
  identity_id?: string;
  folder_id?: string;
  vault_id?: string;
  jump_hosts?: JumpHost[];
  env_vars?: EnvVar[];
  agent_forwarding?: boolean;
  pre_command?: string;
  post_command?: string;
  terminal_encoding?: string;
  pinned?: boolean;
  ping_disabled?: boolean;
  connection_type?: "ssh" | "serial";
  serial_port?: string;
  serial_baud?: number;
  serial_data_bits?: number;
  serial_parity?: string;
  serial_stop_bits?: number;
  serial_flow_control?: string;
}

export interface KnownHost {
  id: string;
  host: string;
  port: number;
  fingerprint: string;
  name?: string;
  vault_id?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  clocks: Record<string, string>;
}

export interface SerialConnectParams {
  sessionId: string;
  port: string;
  baud: number;
  dataBits?: number;
  parity?: string;
  stopBits?: number;
  flowControl?: string;
}

export interface TerminalSession {
  id: string;
  connectionId: string;
  connectionName: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  type: "ssh" | "local" | "multiplayer" | "serial";
  errorMessage?: string;
  encoding?: string;
  serialConfig?: SerialConnectParams;
}

/** A vault option for context menu move/copy actions. id is the stored team ID or "personal". */
export interface VaultOption {
  id: string;
  name: string;
}

export interface Snippet {
  id: string;
  name: string;
  content: string;
  description?: string;
  tags: string[];
  folder_id?: string;
  favorite: boolean;
  only_for_connection_tags: string[];
  only_for_distros: string[];
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  vault_id: string;
  clocks: Record<string, string>;
}

export interface SnippetFormData {
  name: string;
  content: string;
  description?: string;
  tags: string[];
  folder_id?: string;
  favorite: boolean;
  only_for_connection_tags: string[];
  only_for_distros: string[];
  vault_id?: string;
}

export interface PortForwardingRule {
  id: string;
  name: string;
  local_port: number;
  remote_port: number;
  remote_host: string;
  description?: string;
  connection_ids: string[];
  folder_id?: string;
  vault_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  clocks: Record<string, string>;
}

export interface PortForwardingRuleFormData {
  name: string;
  local_port: number;
  remote_port: number;
  remote_host: string;
  description?: string;
  connection_ids: string[];
  folder_id?: string;
  vault_id?: string;
}

export type TunnelOrigin =
  | { type: "auto" }
  | { type: "ad_hoc" }
  | { type: "rule"; rule_id: string; rule_name: string };

export type TunnelState = "active" | { error: string };

export interface ActiveTunnel {
  id: string;
  local_port: number;
  remote_port: number;
  remote_host: string;
  origin: TunnelOrigin;
  state: TunnelState;
  bytes_transferred: number;
}
