import type { OmniCommand } from "@/plugins/api";
import { useUIStore, type NavItem } from "@/stores/uiStore";

type CommandDef = Omit<OmniCommand, "section"> & { section?: string };

/** Wrap a command, defaulting it into the "Actions" section. */
export function defineCommand(def: CommandDef): OmniCommand {
  return { section: "Actions", ...def };
}

type NavCommandDef = Omit<CommandDef, "execute"> & { nav: NavItem };

/** Command that just switches to a top-level nav target. */
export function navCommand({ nav, ...def }: NavCommandDef): OmniCommand {
  return defineCommand({ ...def, execute: () => useUIStore.getState().setActiveNav(nav) });
}

type UIState = ReturnType<typeof useUIStore.getState>;

/** UI store setters that take a single argument (e.g. set*PendingAction). */
type PendingActionSetter = {
  [K in keyof UIState]: UIState[K] extends (action: never) => void ? K : never;
}[keyof UIState];

type PendingActionCommandDef<K extends PendingActionSetter> = Omit<CommandDef, "execute"> & {
  nav: NavItem;
  setter: K;
  action: Parameters<UIState[K]>[0];
};

/** Command that sets a pending action on the UI store, then navigates to its view. */
export function pendingActionCommand<K extends PendingActionSetter>({
  nav,
  setter,
  action,
  ...def
}: PendingActionCommandDef<K>): OmniCommand {
  return defineCommand({
    ...def,
    execute: () => {
      const ui = useUIStore.getState();
      (ui[setter] as (a: typeof action) => void)(action);
      ui.setActiveNav(nav);
    },
  });
}
