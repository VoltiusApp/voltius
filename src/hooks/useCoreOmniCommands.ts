import { useEffect } from "react";
import { usePluginStore } from "@/stores/pluginStore";
import type { OmniCommand } from "@/plugins/api";

const modules = import.meta.glob("../**/*.commands.ts", { eager: true }) as Record<
  string,
  { commands?: OmniCommand[] }
>;

const allCommands: OmniCommand[] = Object.values(modules).flatMap((m) => m.commands ?? []);

export function useCoreOmniCommands() {
  useEffect(() => {
    const { registerOmniCommand, unregisterOmniCommand } = usePluginStore.getState();
    for (const cmd of allCommands) registerOmniCommand(cmd);
    return () => { for (const cmd of allCommands) unregisterOmniCommand(cmd.id); };
  }, []);
}
