import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore } from "@/stores/uiStore";

/** Renders every registered global (shell-level) plugin panel. Each panel owns
 *  its chrome; the host only supplies open state + an onClose that flips it. */
export default function GlobalPanelHost() {
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
          />
        );
      })}
    </>
  );
}
