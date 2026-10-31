import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useOrphanVaultIds } from "@/hooks/useAccessibleVaultIds";
import { unknownVaultLabel } from "@/hooks/accessibleVaults";
import { openVault } from "@/services/openVault";
import { VaultLimitModal, useVaultLimitReached } from "@/components/shared/VaultLimitModal";
import { useLongPress } from "../useLongPress";

interface VaultEntry {
  id: string;
  teamId?: string;
  name: string;
  icon: string;
  /** False for an orphan id: nothing on this device to manage. */
  manageable: boolean;
}

export default function VaultSwitcherSheet() {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const selectVaultOnly = useVaultStore((s) => s.selectVaultOnly);
  const addVault = useVaultStore((s) => s.addVault);
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const push = useMobileNavStore((s) => s.push);
  const orphanVaultIds = useOrphanVaultIds();
  const vaultLimitReached = useVaultLimitReached();
  const [limitOpen, setLimitOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  // Teams that are linked to a local vault already appear as that vault.
  const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
  const entries: VaultEntry[] = [
    ...vaults.map((v) => ({ id: v.id, teamId: v.teamId, name: v.name, icon: "lucide:vault", manageable: true })),
    ...teams.filter((team) => !linkedTeamIds.has(team.id)).map((team) => ({ id: team.id, teamId: team.id, name: team.name, icon: "lucide:users-round", manageable: true })),
    ...orphanVaultIds.map((id) => ({
      id,
      teamId: undefined,
      name: unknownVaultLabel(id),
      icon: "lucide:circle-help",
      manageable: false,
    })),
  ];

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const vault = addVault(trimmed);
    selectVaultOnly(vault.id);
    closeSheet();
  };

  return (
    <BottomSheet title={t("common.entity.vaults")} onClose={closeSheet}>
      {entries.map((e) => (
        <VaultEntryRow
          key={e.id}
          entry={e}
          active={selectedVaultIds[0] === e.id}
          onOpen={() => { openVault(e.id, e.teamId); closeSheet(); }}
          // push() closes the sheet as it opens the page.
          onSettings={e.manageable ? () => push({ kind: "vault-settings", vaultId: e.id }) : undefined}
        />
      ))}

      <div className="my-1 h-px" style={{ background: "var(--t-border)" }} />

      {creating ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <input
            data-vault-new-name
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
            placeholder={t("mobile.sheets.vaultSwitcher.namePlaceholder")}
            className="flex-1 bg-transparent text-sm outline-none rounded-lg px-3 h-10 text-(--t-text-primary)"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
          />
          <button
            data-vault-new-create
            onClick={create}
            disabled={!name.trim()}
            className="px-3 h-10 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--t-accent)", color: "var(--t-on-accent)" }}
          >
            {t("common.action.create")}
          </button>
        </div>
      ) : (
        <button
          data-vault-new
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-(--t-bg-card) text-(--t-accent)"
          onClick={() => (vaultLimitReached ? setLimitOpen(true) : setCreating(true))}
        >
          <Icon icon="lucide:plus" width={18} />
          <span className="text-sm font-medium">{t("mobile.sheets.vaultSwitcher.newVault")}</span>
        </button>
      )}
      {limitOpen && <VaultLimitModal onClose={() => setLimitOpen(false)} />}
    </BottomSheet>
  );
}

/** One vault: tap switches to it; long-press or the trailing ⋮ opens its settings page. */
function VaultEntryRow({ entry, active, onOpen, onSettings }: {
  entry: VaultEntry; active: boolean; onOpen: () => void; onSettings?: () => void;
}) {
  const { t } = useTranslation();
  const press = useLongPress(onSettings ?? (() => {}), onOpen);
  return (
    <div className="flex items-center rounded-xl" style={{ background: active ? "var(--t-bg-card)" : "transparent" }}>
      <button
        data-vault-entry={entry.id}
        className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 rounded-xl text-left"
        {...(onSettings ? press : { onClick: onOpen })}
      >
        <Icon icon={entry.icon} width={18} className="shrink-0 text-(--t-text-dim)" />
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-(--t-text-primary)">{entry.name}</span>
        {active && <Icon icon="lucide:check" width={16} className="shrink-0" style={{ color: "var(--t-accent)" }} />}
      </button>
      {onSettings && (
        <button
          data-vault-entry-settings={entry.id}
          aria-label={t("mobile.vaultSettings.openFor", { name: entry.name })}
          className="vt-icon-btn shrink-0 text-(--t-text-dim)"
          onClick={onSettings}
        >
          <Icon icon="lucide:ellipsis-vertical" width={20} />
        </button>
      )}
    </div>
  );
}
