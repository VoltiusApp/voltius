import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { describePermissions, type PermissionDescriptor } from "@/plugins/gatedPermissions";

interface Props {
  mode: "install" | "update";
  pluginName: string;
  /** All permissions the plugin will hold after this action. */
  permissions: string[];
  /** For updates: permissions newly requested by this version (subset of `permissions`). */
  addedPermissions?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Review dialog shown before executing a plugin's code:
 *  - install: discloses ALL declared permissions; gated/danger perms are shown in a
 *    distinct, warning-styled block with plain-language descriptions.
 *  - update: a non-skippable gate shown when a version requests NEW permissions.
 */
export function PluginPermissionModal({
  mode,
  pluginName,
  permissions,
  addedPermissions = [],
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const added = new Set(addedPermissions);
  const isUpdate = mode === "update";

  const descriptors = describePermissions(permissions);
  const ordinary = descriptors.filter((d) => !d.danger);
  const danger = descriptors.filter((d) => d.danger);

  const renderRow = (d: PermissionDescriptor) => {
    const isNew = added.has(d.perm);
    return (
      <div
        key={d.perm}
        className="flex flex-col gap-0.5 px-2.5 py-2 rounded-md"
        style={
          d.danger
            ? { background: "color-mix(in srgb, var(--t-error, #ef4444) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--t-error, #ef4444) 35%, transparent)" }
            : { background: "var(--t-bg-base)" }
        }
      >
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: d.danger ? "var(--t-error, #ef4444)" : "var(--t-text-bright)" }}>
          {d.danger && <Icon icon="lucide:alert-triangle" width={12} />}
          {isNew && <Icon icon="lucide:plus" width={11} />}
          <span>{d.known ? t(d.labelKey) : d.perm}</span>
        </div>
        {d.known && (
          <p className="text-xs" style={{ color: d.danger ? "color-mix(in srgb, var(--t-error, #ef4444) 85%, var(--t-text-secondary))" : "var(--t-text-dim)" }}>
            {t(d.descriptionKey)}
          </p>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={onCancel} onEnter={onConfirm}>
      <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem] max-w-[26.667rem]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)" }}
          >
            <Icon icon="lucide:shield-check" width={16} className="text-(--t-accent)" />
          </div>
          <h2 className="text-sm font-semibold text-(--t-text-bright)">
            {isUpdate
              ? t("settings.plugins.permissionModal.updateTitle", { name: pluginName })
              : t("settings.plugins.permissionModal.installTitle", { name: pluginName })}
          </h2>
        </div>

        <p className="text-sm text-(--t-text-secondary)">
          {isUpdate
            ? t("settings.plugins.permissionModal.updateBody")
            : t("settings.plugins.permissionModal.installBody")}
        </p>

        {descriptors.length === 0 ? (
          <p className="text-xs text-(--t-text-dim)">
            {t("settings.plugins.permissionModal.noPermissions")}
          </p>
        ) : (
          <div className="flex flex-col gap-3 max-h-[22rem] overflow-y-auto">
            {isUpdate && (
              <p className="text-xs font-medium text-(--t-text-dim)">
                {t("settings.plugins.permissionModal.newPermissions")}
              </p>
            )}
            {ordinary.length > 0 && (
              <div className="flex flex-col gap-1.5">{ordinary.map(renderRow)}</div>
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
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium">
            {t("common.action.cancel")}
          </button>
          <button onClick={onConfirm} className="btn btn-primary px-4 py-2 rounded-lg text-sm font-medium">
            {isUpdate
              ? t("settings.plugins.permissionModal.updateConfirm")
              : t("settings.plugins.permissionModal.installConfirm")}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
