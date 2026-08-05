import { invoke } from "@tauri-apps/api/core";
import type { Identity, IdentityFormData } from "@/types";

export async function listIdentities(): Promise<Identity[]> {
  return invoke("identity_list");
}

export async function saveIdentity(data: IdentityFormData): Promise<Identity> {
  return invoke("identity_save", { data });
}

export async function updateIdentity(id: string, data: IdentityFormData): Promise<Identity> {
  return invoke("identity_update", { id, data });
}

/** Migration-only: re-creates a team-vault identity locally under its own id. */
export async function adoptIdentity(id: string, data: IdentityFormData): Promise<Identity> {
  return invoke("identity_adopt", { id, data });
}

export async function deleteIdentity(id: string): Promise<void> {
  return invoke("identity_delete", { id });
}
