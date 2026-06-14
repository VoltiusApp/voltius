import { useState } from "react";
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
  const addVault = useVaultStore((s) => s.addVault);
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  // Teams that are linked to a local vault already appear as that vault.
  const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
  const entries = [
    ...vaults.map((v) => ({ id: v.id, name: v.name, icon: "lucide:vault" })),
    ...teams.filter((t) => !linkedTeamIds.has(t.id)).map((t) => ({ id: t.id, name: t.name, icon: "lucide:users-round" })),
  ];

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const vault = addVault(trimmed);
    selectVaultOnly(vault.id);
    closeSheet();
  };

  return (
    <BottomSheet title="Vaults" onClose={closeSheet} registerBack={false}>
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

      <div className="my-1 h-px" style={{ background: "var(--t-border)" }} />

      {creating ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <input
            data-vault-new-name
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
            placeholder="Vault name"
            className="flex-1 bg-transparent text-sm outline-none rounded-lg px-3 h-10 text-(--t-text-primary)"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
          />
          <button
            data-vault-new-create
            onClick={create}
            disabled={!name.trim()}
            className="px-3 h-10 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--t-accent)", color: "#fff" }}
          >
            Create
          </button>
        </div>
      ) : (
        <button
          data-vault-new
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-(--t-bg-card) text-(--t-accent)"
          onClick={() => setCreating(true)}
        >
          <Icon icon="lucide:plus" width={18} />
          <span className="text-sm font-medium">New vault</span>
        </button>
      )}
    </BottomSheet>
  );
}
