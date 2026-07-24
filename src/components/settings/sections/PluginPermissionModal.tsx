import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";

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
 *  - install: discloses all declared permissions (gated by the plugin-install-review setting).
 *  - update: a non-skippable gate shown only when a version requests NEW permissions; the added
 *    ones are emphasized, the rest listed for context.
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

        {permissions.length > 0 ? (
          <div className="flex flex-col gap-2">
            {isUpdate && (
              <p className="text-xs font-medium text-(--t-text-dim)">
                {t("settings.plugins.permissionModal.newPermissions")}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {permissions.map((perm) => {
                const isNew = added.has(perm);
                return (
                  <span
                    key={perm}
                    className="text-xs px-2 py-1 rounded-md flex items-center gap-1"
                    style={
                      isNew
                        ? { background: "color-mix(in srgb, var(--t-accent) 18%, transparent)", color: "var(--t-accent)" }
                        : { background: "var(--t-bg-base)", color: "var(--t-text-dim)" }
                    }
                  >
                    {isNew && <Icon icon="lucide:plus" width={11} />}
                    {perm}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-(--t-text-dim)">
            {t("settings.plugins.permissionModal.noPermissions")}
          </p>
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
