import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { getMyUserId } from "@/services/teamService";
import { effectivePermissions, PERM_BITS } from "@/hooks/usePermission";

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-[var(--t-text-primary)]">
      <span
        onClick={() => onChange(!checked)}
        className="flex items-center justify-center w-4 h-4 rounded transition-colors shrink-0"
        style={{
          background: checked ? "var(--t-accent)" : "var(--t-bg-input)",
          border: `1px solid ${checked ? "var(--t-accent)" : "var(--t-border-hover)"}`,
        }}
      >
        {checked && <Icon icon="lucide:check" width={10} color="white" />}
      </span>
      {label}
    </label>
  );
}

export function Radio({ checked, onChange, label, sub }: { checked: boolean; onChange: () => void; label: string; sub?: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none" onClick={onChange}>
      <span
        className="flex items-center justify-center w-4 h-4 rounded-full mt-0.5 shrink-0 transition-colors"
        style={{
          border: `2px solid ${checked ? "var(--t-accent)" : "var(--t-border-hover)"}`,
          background: checked ? "var(--t-accent)" : "transparent",
        }}
      >
        {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
      </span>
      <div>
        <span className="text-sm text-[var(--t-text-primary)]">{label}</span>
        {sub && <p className="text-xs mt-0.5 text-[var(--t-text-muted)]">{sub}</p>}
      </div>
    </label>
  );
}

export function ActionBtn({ icon, label, onClick, primary, disabled }: {
  icon: string; label: string; onClick: () => void; primary?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      style={{
        background: primary ? "var(--t-accent)" : "var(--t-bg-elevated)",
        color: primary ? "#fff" : "var(--t-text-primary)",
        border: primary ? "none" : "1px solid var(--t-border-hover)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.opacity = "0.85"; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.opacity = "1"; }}
    >
      <Icon icon={icon} width={15} />
      {label}
    </button>
  );
}

export function VaultChipSelect({ selectedIds, onChange, writableOnly = false }: {
  selectedIds: string[]; onChange: (ids: string[]) => void; writableOnly?: boolean;
}) {
  const { vaults } = useVaultStore();
  const { teams, membersByTeam, rolesByTeam } = useTeamStore();
  const [myUserId, setMyUserId] = useState("");

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
  }, []);

  const canWrite = (vId: string): boolean => {
    if (vId === "personal") return true;
    const member = membersByTeam[vId]?.find((m) => m.user_id === myUserId);
    if (!member || !myUserId) return true;
    const roles = rolesByTeam[vId] ?? [];
    if (roles.length === 0) return true;
    return (effectivePermissions(member, roles) & PERM_BITS.EDIT_CONNECTIONS) !== 0;
  };

  const linkedTeamIds = new Set(vaults.map(v => v.teamId).filter(Boolean));
  const allVaults = [
    ...vaults.map(v => ({ id: v.teamId ?? v.id, name: v.name })),
    ...teams.filter(t => !linkedTeamIds.has(t.id)).map(t => ({ id: t.id, name: t.name })),
  ].filter(v => !writableOnly || canWrite(v.id));

  if (allVaults.length <= 1) return null;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      if (selectedIds.length === 1) return;
      onChange(selectedIds.filter(v => v !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {allVaults.map(v => {
        const active = selectedIds.includes(v.id);
        return (
          <button key={v.id} type="button" onClick={() => toggle(v.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: active ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-elevated)",
              border: `1px solid ${active ? "var(--t-accent)" : "var(--t-border-hover)"}`,
              color: active ? "var(--t-accent)" : "var(--t-text-muted)",
            }}
          >
            <Icon icon="lucide:vault" width={11} />
            {v.name}
          </button>
        );
      })}
    </div>
  );
}
