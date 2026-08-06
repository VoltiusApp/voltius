import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore } from "@/stores/uiStore";

/** Renders every registered global (shell-level) plugin panel. Each panel owns
 *  its chrome; the host only supplies open state, an onClose that flips it, and
 *  whether the shell wants it full-screen (the mobile shell does — there is no
 *  room to dock a side drawer on a phone). */
export default function GlobalPanelHost({ fullScreen }: { fullScreen?: boolean }) {
  const panels = usePluginStore((s) => s.globalPanels);
  const openMap = useUIStore((s) => s.globalPanelOpen);
  const setOpen = useUIStore((s) => s.setGlobalPanelOpen);
  return (
    <>
      {[...panels.values()].map((panel) => {
        const Component = panel.component;
        return (
          <Component
            key={panel.id}
            open={openMap[panel.id] ?? false}
            onClose={() => setOpen(panel.id, false)}
            fullScreen={fullScreen}
          />
        );
      })}
    </>
  );
}
