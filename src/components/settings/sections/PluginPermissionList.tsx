import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { describePermissions, type PermissionDescriptor } from "@/plugins/gatedPermissions";

interface Props {
  /** All permissions the plugin will hold after this action. */
  permissions: string[];
  /** For updates: permissions newly requested by this version (subset of `permissions`). */
  addedPermissions?: string[];
  /** Labels the block as "new permissions" — an update gate, not a first install. */
  showNewHeading?: boolean;
}

/**
 * Discloses what a plugin's code will be allowed to do. Shared by the settings
 * install/update gate and the deep-link install sheet, so a link-driven install
 * cannot end up disclosing less than a click-driven one.
 */
export function PluginPermissionList({ permissions, addedPermissions = [], showNewHeading = false }: Props) {
  const { t } = useTranslation();
  const added = new Set(addedPermissions);

  const descriptors = describePermissions(permissions);
  const ordinary = descriptors.filter((d) => !d.gated);
  const readOnly = descriptors.filter((d) => d.gated && !d.danger);
  const danger = descriptors.filter((d) => d.danger);

  const renderRow = (d: PermissionDescriptor) => {
    const isNew = added.has(d.perm);
    // Three tones, not two: a gated read-only perm is neither ordinary (it still
    // needs consent) nor destructive. Accent-tinted, no warning triangle.
    const elevated = d.gated && !d.danger;
    return (
      <div
        key={d.perm}
        className="flex flex-col gap-0.5 px-2.5 py-2 rounded-md"
        style={
          d.danger
            ? { background: "color-mix(in srgb, var(--t-error, #ef4444) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--t-error, #ef4444) 35%, transparent)" }
            : elevated
              ? { background: "color-mix(in srgb, var(--t-accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)" }
              : { background: "var(--t-bg-base)" }
        }
      >
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: d.danger ? "var(--t-error, #ef4444)" : elevated ? "var(--t-accent)" : "var(--t-text-bright)" }}>
          {d.danger && <Icon icon="lucide:alert-triangle" width={12} />}
          {elevated && <Icon icon="lucide:eye" width={12} />}
          {isNew && <Icon icon="lucide:plus" width={11} />}
          <span>{d.known ? t(d.labelKey) : d.perm}</span>
        </div>
        {d.known && (
          <p className="text-xs" style={{ color: d.danger ? "color-mix(in srgb, var(--t-error, #ef4444) 85%, var(--t-text-secondary))" : elevated ? "color-mix(in srgb, var(--t-accent) 70%, var(--t-text-secondary))" : "var(--t-text-dim)" }}>
            {t(d.descriptionKey)}
          </p>
        )}
      </div>
    );
  };

  if (descriptors.length === 0) {
    return (
      <p className="text-xs text-(--t-text-dim)">
        {t("settings.plugins.permissionModal.noPermissions")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 max-h-[22rem] overflow-y-auto">
      {showNewHeading && (
        <p className="text-xs font-medium text-(--t-text-dim)">
          {t("settings.plugins.permissionModal.newPermissions")}
        </p>
      )}
      {ordinary.length > 0 && (
        <div className="flex flex-col gap-1.5">{ordinary.map(renderRow)}</div>
      )}
      {readOnly.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--t-accent)" }}>
            <Icon icon="lucide:eye" width={13} />
            {t("settings.plugins.permissionModal.permissions.readOnlyHeading")}
          </div>
          <p className="text-xs text-(--t-text-secondary)">
            {t("settings.plugins.permissionModal.permissions.readOnlyWarning")}
          </p>
          {readOnly.map(renderRow)}
        </div>
      )}
      {danger.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--t-error, #ef4444)" }}>
            <Icon icon="lucide:alert-triangle" width={13} />
            {t("settings.plugins.permissionModal.permissions.dangerHeading")}
          </div>
          <p className="text-xs text-(--t-text-secondary)">
            {t("settings.plugins.permissionModal.permissions.dangerWarning")}
          </p>
          {danger.map(renderRow)}
        </div>
      )}
    </div>
  );
}
