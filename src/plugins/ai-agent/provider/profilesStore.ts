import type { PluginAPI } from "@/plugins/api";
import type { ProviderProfile } from "../types";

const PROFILES_KEY = "providerProfiles";
const ACTIVE_KEY = "activeProfileId";
const keychainKey = (id: string) => `ai-agent:provider:${id}:apiKey`;

export interface ProfilesStore {
  list(): Promise<ProviderProfile[]>;
  getActiveId(): Promise<string | null>;
  save(profile: ProviderProfile): Promise<void>;
  remove(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
  getKey(id: string): Promise<string | null>;
  setKey(id: string, key: string): Promise<void>;
  deleteKey(id: string): Promise<void>;
}

export function createProfilesStore(
  api: Pick<PluginAPI, "storage" | "keychain">,
): ProfilesStore {
  const list = async (): Promise<ProviderProfile[]> =>
    (await api.storage.get<ProviderProfile[]>(PROFILES_KEY)) ?? [];

  return {
    list,
    getActiveId: () => api.storage.get<string>(ACTIVE_KEY),
    async save(profile) {
      const profiles = await list();
      const idx = profiles.findIndex((p) => p.id === profile.id);
      if (idx >= 0) profiles[idx] = profile;
      else profiles.push(profile);
      await api.storage.set(PROFILES_KEY, profiles);
      const active = await api.storage.get<string>(ACTIVE_KEY);
      if (!active) await api.storage.set(ACTIVE_KEY, profile.id);
    },
    async remove(id) {
      const profiles = (await list()).filter((p) => p.id !== id);
      await api.storage.set(PROFILES_KEY, profiles);
      await api.keychain.delete(keychainKey(id));
      if ((await api.storage.get<string>(ACTIVE_KEY)) === id) {
        await api.storage.set(ACTIVE_KEY, profiles[0]?.id ?? null);
      }
    },
    setActive: (id) => api.storage.set(ACTIVE_KEY, id),
    getKey: (id) => api.keychain.get(keychainKey(id)),
    setKey: (id, key) => api.keychain.set(keychainKey(id), key),
    deleteKey: (id) => api.keychain.delete(keychainKey(id)),
  };
}
