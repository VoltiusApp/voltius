import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { PluginPermissionList } from "@/components/settings/sections/PluginPermissionList";

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
  const isUpdate = mode === "update";

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

        <PluginPermissionList
          permissions={permissions}
          addedPermissions={addedPermissions}
          showNewHeading={isUpdate}
        />

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
