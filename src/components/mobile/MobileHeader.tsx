import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";

export default function MobileHeader({ title, onAdd }: { title?: string; onAdd?: () => void }) {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const openSheet = useMobileNavStore((s) => s.openSheet);

  const id = selectedVaultIds[0];
  const vaultName =
    vaults.find((v) => v.id === id)?.name ?? teams.find((t) => t.id === id)?.name ?? "Vault";

  return (
    <header
      className="shrink-0 flex items-center justify-between px-4 h-12 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
    >
      <button
        data-mobile-vault-switch
        className="flex items-center gap-1.5 text-base font-semibold text-(--t-text-primary)"
        onClick={() => openSheet({ kind: "vault-switcher" })}
      >
        {title ?? vaultName}
        <Icon icon="lucide:chevron-down" width={16} className="text-(--t-text-dim)" />
      </button>
      {onAdd && (
        <button data-mobile-add onClick={onAdd} className="p-2 -mr-2 text-(--t-text-primary)">
          <Icon icon="lucide:plus" width={22} />
        </button>
      )}
    </header>
  );
}
