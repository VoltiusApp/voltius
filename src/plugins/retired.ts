export const RETIRED_PLUGIN_IDS: ReadonlySet<string> = new Set(["plugin-ssh-config"]);

export const isRetiredPlugin = (id: string) => RETIRED_PLUGIN_IDS.has(id);
