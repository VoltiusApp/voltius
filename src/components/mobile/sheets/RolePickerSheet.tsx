import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TeamRole } from "@/services/teamService";
import { roleLabel } from "@/components/members/roleChips";
import { roleColor } from "@/components/members/roleBadges";
import BottomSheet from "./BottomSheet";

export default function RolePickerSheet({ title, roles, mode, selectedIds = [], disabledReason, onPick, onClose }: {
  title: string;
  roles: TeamRole[];
  mode: "pick" | "toggle";
  selectedIds?: string[];
  disabledReason?: (r: TeamRole) => string | null;
  onPick: (r: TeamRole) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet title={title} onClose={onClose}>
      {roles.map((r) => {
        const reason = disabledReason?.(r) ?? null;
        const checked = selectedIds.includes(r.id);
        return (
          <button
            key={r.id}
            data-role-pick={r.id}
            role={mode === "toggle" ? "menuitemcheckbox" : "menuitem"}
            aria-checked={mode === "toggle" ? checked : undefined}
            disabled={!!reason}
            className="w-full min-h-12 flex items-center gap-3 px-3 py-3 rounded-xl text-left active:bg-(--t-bg-card) disabled:opacity-50"
            onClick={() => { onPick(r); if (mode === "pick") onClose(); }}
          >
            <span aria-hidden className="w-3 h-3 shrink-0 rounded-full" style={{ background: roleColor(r) }} />
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-sm font-medium text-(--t-text-primary) truncate">{roleLabel(t, r.name)}</span>
              {reason && <span className="text-xs text-(--t-text-dim)">{reason}</span>}
            </span>
            {checked && <Icon icon="lucide:check" width={18} className="shrink-0 text-(--t-accent)" />}
          </button>
        );
      })}
    </BottomSheet>
  );
}
