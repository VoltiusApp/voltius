import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useTeamStore } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { ContentCounts } from "@/components/shared/ContentCounts";
import { openBillingCheckout } from "@/services/billingCheckout";
import { VaultSettingsBody } from "@/components/vault-admin/VaultSettingsBody";
import { VaultAdminDialogs, type VaultDialog } from "@/components/vault-admin/VaultAdminDialogs";
import type { VaultAdminTarget as VaultDetail } from "@/components/vault-admin/vaultAdminTarget";

// ─── Upgrade to teams CTA ──────────────────────────────────────────────────────

export function UpgradeToTeamsCTA() {
  const { t } = useTranslation();
  const openCheckout = async () => {
    await openBillingCheckout("teams");
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(99,102,241,0.12)" }}>
        <Icon icon="lucide:users-round" width={22} style={{ color: "var(--t-accent)" }} />
      </div>
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: "var(--t-text-primary)" }}>{t("settings.vaults.upgrade.requiresTeams")}</p>
        <p className="text-xs max-w-xs" style={{ color: "var(--t-text-dim)" }}>
          {t("settings.vaults.upgrade.upgradeDesc")}
        </p>
      </div>
      <button
        onClick={() => void openCheckout()}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white"
        style={{ background: "var(--t-accent)" }}
      >
        {t("settings.vaults.upgrade.upgradeBtn")}
      </button>
    </div>
  );
}

// ─── Vault content counts (list row, skips zeros) ─────────────────────────────

function VaultContentCounts({ vaultId }: { vaultId: string }) {
  return <ContentCounts counts={useVaultContents(vaultId)} />;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type VaultItem =
  | { kind: "local"; vault: import("@/stores/vaultStore").Vault }
  | { kind: "cloud"; teamId: string; name: string };

// ─── Main section ─────────────────────────────────────────────────────────────

export default function VaultsSection() {
  const { t } = useTranslation();
  const { vaults, addVault } = useVaultStore();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const vaultsContributions = useUIContributions("settings.vaults");

  const { teams, loadTeams } = useTeamStore();
  const { isPro, accountMode } = useSubscriptionStore();
  const openSettings = useUIStore((s) => s.openSettings);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);

  const [detail, setDetail] = useState<VaultDetail | null>(null);
  const [dialog, setDialog] = useState<VaultDialog>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");

  useEffect(() => { loadTeams().catch(() => {}); }, [loadTeams]);

  const handleCreateVault = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVaultName.trim()) return;
    if (!isPro && vaults.length >= 1) {
      setShowCreate(false);
      setNewVaultName("");
      if (accountMode === "server") openSettings("account");
      else openCloudAuth("signin");
      return;
    }
    const vault = addVault(newVaultName.trim());
    setNewVaultName(""); setShowCreate(false);
    setDetail({ kind: "local", vaultId: vault.id, teamId: null, name: vault.name });
  };

  const openDetail = (d: VaultDetail) => {
    setDetail(d);
  };

  if (detail) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--t-border)" }}>
          <button
            onClick={() => setDetail(null)}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: "var(--t-text-dim)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
          >
            <Icon icon="lucide:chevron-left" width={14} />
            {t("settings.vaults.back")}
          </button>
          <Icon icon="lucide:chevron-right" width={12} style={{ color: "var(--t-text-dim)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--t-text-primary)" }}>{detail.name}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <VaultSettingsBody
            target={detail}
            onRenamed={(name) => setDetail((d) => d ? { ...d, name } : null)}
            onDone={() => setDetail(null)}
            onRequestDialog={setDialog}
          />
          <VaultAdminDialogs
            target={detail}
            dialog={dialog}
            onClose={() => setDialog(null)}
            onRenamed={(name) => setDetail((d) => d ? { ...d, name } : null)}
            onDone={() => setDetail(null)}
          />
        </div>
      </div>
    );
  }

  const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
  const standaloneTeams = teams.filter((team) => !linkedTeamIds.has(team.id));
  const allItems: VaultItem[] = [
    ...vaults.map((v): VaultItem => ({ kind: "local", vault: v })),
    ...standaloneTeams.map((team): VaultItem => ({ kind: "cloud", teamId: team.id, name: team.name })),
  ];

  return (
    <div className="p-6 space-y-8">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("settings.vaults.title")}</h3>
          <button
            onClick={() => {
              if (!isPro && vaults.length >= 1) {
                if (accountMode === "server") openSettings("account");
                else openCloudAuth("signin");
                return;
              }
              setShowCreate((v) => !v);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
            style={{ color: "var(--t-text-dim)", background: showCreate ? "var(--t-bg-elevated)" : "transparent", border: "1px solid var(--t-border)" }}
          >
            <Icon icon="lucide:plus" width={11} />
            {t("settings.vaults.newVault")}
          </button>
        </div>
        <p className="text-xs mb-4 text-(--t-text-muted)">{t("settings.vaults.desc")}</p>

        {showCreate && (
          <form onSubmit={handleCreateVault} className="flex gap-2 mb-4">
            <input
              autoFocus
              type="text"
              placeholder={t("settings.vaults.vaultNamePlaceholder")}
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              className="form-input flex-1 px-3 py-2 rounded-lg text-sm outline-hidden"
              style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
            />
            <button
              type="submit"
              disabled={!newVaultName.trim()}
              className="px-3 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: "var(--t-accent)", opacity: !newVaultName.trim() ? 0.6 : 1 }}
            >
              {t("settings.vaults.create")}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewVaultName(""); }}
              className="px-3 py-2 rounded-lg text-sm"
              style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-muted)" }}
            >
              {t("settings.shared.cancel")}
            </button>
          </form>
        )}

        <div className="space-y-2">
          {allItems.map((item) => {
            const id = item.kind === "local" ? item.vault.id : item.teamId;
            const name = item.kind === "local" ? item.vault.name : item.name;
            const teamId = item.kind === "local" ? (item.vault.teamId ?? null) : item.teamId;
            const isTeam = !!teamId;
            const hovered = hoveredId === id;

            return (
              <div
                key={id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all"
                style={{
                  background: "var(--t-bg-elevated)",
                  border: `1.5px solid ${hovered ? "var(--t-border-hover)" : "var(--t-border)"}`,
                }}
                onMouseEnter={() => setHoveredId(id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => openDetail({
                  kind: item.kind,
                  vaultId: item.kind === "local" ? item.vault.id : null,
                  teamId,
                  name,
                })}
              >
                <Icon icon="lucide:vault" width={16} className="shrink-0" style={{ color: "var(--t-text-muted)" }} />
                <p className="flex-1 text-sm font-medium text-(--t-text-primary) truncate">{name}</p>

                {item.kind === "local" && hovered && (
                  <div className="flex items-center gap-2.5 shrink-0">
                    <VaultContentCounts vaultId={item.vault.id} />
                  </div>
                )}

                {item.kind === "local" && hovered && (
                  <_HoverSeparator vaultId={item.vault.id} />
                )}

                <div className="flex items-center gap-1 shrink-0" style={{ color: "var(--t-text-dim)" }}>
                  <Icon icon={isTeam ? "lucide:users-round" : "lucide:user-round"} width={12} />
                  <span className="text-xs">{isTeam ? t("settings.vaults.team") : t("settings.vaults.onlyYou")}</span>
                </div>

                <Icon icon="lucide:chevron-right" width={13} className="shrink-0" style={{ color: "var(--t-text-dim)" }} />
              </div>
            );
          })}
        </div>
      </div>

      {vaultsContributions.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-1 text-(--t-text-dim)">{t("settings.vaults.importExport.title")}</h3>
          <p className="text-xs mb-4 text-(--t-text-muted)">
            {t("settings.vaults.importExport.desc")}
          </p>
          <div className="flex gap-3">
            {vaultsContributions.map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors bg-(--t-bg-elevated) text-(--t-text-primary) border border-(--t-border-hover)"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
              >
                {action.icon && <Icon icon={action.icon} width={15} className="text-(--t-accent)" />}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function _HoverSeparator({ vaultId }: { vaultId: string }) {
  const hasNonZero = useVaultContents(vaultId).some((c) => c.count > 0);
  if (!hasNonZero) return null;
  return <div className="w-px h-3.5 shrink-0" style={{ background: "var(--t-border)" }} />;
}
