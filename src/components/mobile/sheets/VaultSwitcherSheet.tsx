import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";

export default function VaultSwitcherSheet() {
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const selectVaultOnly = useVaultStore((s) => s.selectVaultOnly);
  const closeSheet = useMobileNavStore((s) => s.closeSheet);

  // Teams that are linked to a local vault already appear as that vault.
  const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
  const entries = [
    ...vaults.map((v) => ({ id: v.id, name: v.name, icon: "lucide:vault" })),
    ...teams.filter((t) => !linkedTeamIds.has(t.id)).map((t) => ({ id: t.id, name: t.name, icon: "lucide:users-round" })),
  ];

  return (
    <BottomSheet title="Vaults" onClose={closeSheet}>
      {entries.map((e) => {
        const active = selectedVaultIds[0] === e.id;
        return (
          <button
            key={e.id}
            data-vault-entry={e.id}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left"
            style={{ background: active ? "var(--t-bg-card)" : "transparent" }}
            onClick={() => { selectVaultOnly(e.id); closeSheet(); }}
          >
            <Icon icon={e.icon} width={18} className="text-(--t-text-dim)" />
            <span className="flex-1 text-sm font-medium text-(--t-text-primary)">{e.name}</span>
            {active && <Icon icon="lucide:check" width={16} style={{ color: "var(--t-accent)" }} />}
          </button>
        );
      })}
    </BottomSheet>
  );
}
