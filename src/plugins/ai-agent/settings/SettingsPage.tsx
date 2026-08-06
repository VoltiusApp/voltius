import { Icon } from "@voltius/ui";
import { useT } from "../useT";
import type { PluginAPI } from "@/plugins/api";
import { PermissionsBlock } from "./PermissionsBlock";
import { ProfilesBlock } from "./ProfilesBlock";
import { AllowlistBlock } from "./AllowlistBlock";

/**
 * Rendered inside PluginsSection's drill-in, which already supplies the back
 * bar, `p-6` and the scroll container — so this owns neither padding nor
 * overflow, only the heading and the three blocks.
 */
export function createSettingsPage(api: PluginAPI): React.FC {
  return function AiAgentSettings() {
    const { t } = useT();
    return (
      <div className="flex flex-col gap-6 max-w-lg">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Icon icon="lucide:sparkles" width={18} className="text-(--t-text-primary)" />
            <h2 className="text-base font-semibold text-(--t-text-primary)">
              {t("aiAgent.settings.title")}
            </h2>
          </div>
          <p className="text-sm text-(--t-text-dim)">{t("aiAgent.settings.subtitle")}</p>
        </div>
        <ProfilesBlock />
        <PermissionsBlock api={api} />
        <AllowlistBlock />
      </div>
    );
  };
}
