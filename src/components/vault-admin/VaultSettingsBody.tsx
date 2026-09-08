import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useVaultContents } from "@/hooks/useVaultContents";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultAdminActions } from "./useVaultAdminActions";
import { vaultAdminCapabilities, type VaultAdminTarget } from "./vaultAdminTarget";

export function VaultSettingsBody({
  target, onRenamed, onDone, onRequestDialog,
}: {
  target: VaultAdminTarget;
  onRenamed: (name: string) => void;
  onDone: () => void;
  onRequestDialog: (dialog: "makePrivate" | "delete") => void;
}) {
  const { t } = useTranslation();
  const { teams, rolesByTeam, membersByTeam } = useTeamStore();
  const caps = vaultAdminCapabilities(target, teams, rolesByTeam);
  const { rename } = useVaultAdminActions(target, { onRenamed, onDone });
  const counts = useVaultContents(target.vaultId ?? undefined);
  const [name, setName] = useState(target.name);

  const memberCount = target.teamId ? (membersByTeam[target.teamId]?.length ?? null) : null;
  const nonZeroCounts = counts.filter((c) => c.count > 0);

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    rename(name);
  };

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="vault-name" className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
          {t("settings.vaults.general.vaultNameLabel")}
        </label>
        {caps.canRename ? (
          <form onSubmit={handleRename} className="flex gap-2">
            <input
              id="vault-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input flex-1 px-3 py-2 rounded-lg text-sm outline-hidden"
              style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
            />
            <button
              type="submit"
              disabled={!name.trim() || name.trim() === target.name}
              className="px-3 py-2 rounded-lg text-sm font-medium text-white shrink-0"
              style={{ background: "var(--t-accent)", opacity: !name.trim() || name.trim() === target.name ? 0.5 : 1 }}
            >
              {t("settings.vaults.general.save")}
            </button>
          </form>
        ) : (
          <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{target.name}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--t-text-dim)" }}>
          {t("settings.vaults.general.infoLabel")}
        </label>
        <div className="flex flex-wrap gap-3">
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-secondary)" }}
          >
            <Icon icon={caps.isTeam ? "lucide:users-round" : "lucide:user-round"} width={12} />
            {caps.isTeam
              ? (memberCount !== null
                  ? t("settings.vaults.general.teamWithCount", { count: memberCount })
                  : t("settings.vaults.general.teamLoading"))
              : t("settings.vaults.general.private")
            }
          </div>

          {nonZeroCounts.map(({ icon, count }) => (
            <div
              key={icon}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-secondary)" }}
            >
              <Icon icon={icon} width={12} />
              {count}
            </div>
          ))}

          {target.kind === "cloud" && (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-dim)" }}
            >
              <Icon icon="lucide:cloud" width={12} />
              {t("settings.vaults.general.cloudOnly")}
            </div>
          )}
        </div>

        {target.kind === "cloud" && (
          <p className="text-xs mt-3" style={{ color: "var(--t-text-dim)" }}>
            {t("settings.vaults.general.cloudOnlyDesc")}
          </p>
        )}
      </div>

      {(caps.canDelete || caps.canMakePrivate) && (
        <div style={{ borderTop: "1px solid var(--t-border)", paddingTop: "0.75rem" }}>
          {caps.canMakePrivate && (
            <button
              onClick={() => onRequestDialog("makePrivate")}
              className="flex items-center gap-2 py-1.5 text-sm"
              style={{ color: "var(--t-status-warning)" }}
            >
              <Icon icon="lucide:lock" width={13} />
              {t("settings.vaults.general.makePrivate.btn")}
            </button>
          )}
          {caps.canDelete && (
            <button
              onClick={() => onRequestDialog("delete")}
              className="flex items-center gap-2 py-1.5 text-sm"
              style={{ color: "var(--t-status-error)" }}
            >
              <Icon icon="lucide:trash-2" width={13} />
              {t("settings.vaults.general.deleteVault.btn")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
