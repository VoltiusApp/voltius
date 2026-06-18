import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";
import { SETTINGS_NAV } from "@/components/settings/settingsNav";
import { renderSettingsSection } from "@/components/settings/settingsSections";
import { mobileSettingsNav, MOBILE_HIDDEN_SECTIONS } from "@/components/settings/settingsMobileCore";

export default function MobileSettings() {
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const rawSubPage = useUIStore((s) => s.settingsSubPage);
  const setSubPage = useUIStore((s) => s.setSettingsSubPage);
  // Hardware back drives this via the store; hidden sections fall back to the list.
  const subPage = rawSubPage && !MOBILE_HIDDEN_SECTIONS.has(rawSubPage) ? rawSubPage : null;

  const nav = mobileSettingsNav(SETTINGS_NAV);
  const current = nav.find((n) => n.id === subPage);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col surface-modal-solid animate-fadeIn"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0 border-b border-b-(--t-border)">
        {subPage ? (
          <button
            onClick={() => setSubPage(null)}
            className="p-1.5 -ml-1.5 rounded-lg text-(--t-text-muted) active:bg-(--t-bg-card-hover)"
            aria-label="Back"
          >
            <Icon icon="lucide:arrow-left" width={18} />
          </button>
        ) : null}
        <span className="flex-1 text-base font-semibold text-(--t-text-bright)">
          {current ? current.label : "Settings"}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="p-1.5 -mr-1.5 rounded-lg text-(--t-text-muted) active:bg-(--t-bg-card-hover)"
          aria-label="Close settings"
        >
          <Icon icon="lucide:x" width={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {subPage ? (
          renderSettingsSection(subPage)
        ) : (
          <div className="py-2">
            {nav.map((item) => (
              <button
                key={item.id}
                onClick={() => setSubPage(item.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-(--t-bg-card-hover) border-b border-b-(--t-border)"
              >
                <Icon icon={item.icon} width={18} className="shrink-0 text-(--t-accent)" />
                <span className="flex-1 text-sm text-(--t-text-primary)">{item.label}</span>
                <Icon icon="lucide:chevron-right" width={16} className="shrink-0 text-(--t-text-dim)" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
