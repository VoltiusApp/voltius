import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import type { MobileScreen } from "@/stores/mobileNavCore";
import { isMobileShell } from "@/utils/platform";
import { FormSection } from "@/components/shared/Panel";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import type { Connection, Identity } from "@/types";

export interface HostUnlink {
  allowed: (conn: Connection) => boolean;
  run: (conn: Connection) => void;
}

function RowButton({ icon, title, hoverColor, disabled, onClick }: {
  icon: string;
  title: string;
  hoverColor: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded-lg transition-colors shrink-0 text-(--t-text-dim) disabled:opacity-40 disabled:cursor-not-allowed"
      onMouseEnter={(e) => { if (disabled) return; e.currentTarget.style.color = hoverColor; e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; e.currentTarget.style.background = "transparent"; }}
    >
      <Icon icon={icon} width={14} />
    </button>
  );
}

function LinkedRow({ avatar, title, subtitle, children }: { avatar: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-(--t-bg-base)">
      {avatar}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate font-medium text-(--t-text-bright)">{title}</p>
        <p className="text-xs truncate text-(--t-text-secondary)">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

const avatarStyle = { width: "1.867rem", height: "1.867rem" };

export function LinkedToSection({ hosts, identities = [], unlink, onLeave }: {
  hosts: Connection[];
  identities?: Identity[];
  unlink?: HostUnlink;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { setActiveNav, setHomePendingAction, setKeychainPendingAction } = useUIStore();
  if (hosts.length === 0 && identities.length === 0) return null;

  const open = (mobile: MobileScreen, desktop: () => void) => {
    onLeave();
    if (isMobileShell()) useMobileNavStore.getState().push(mobile);
    else desktop();
  };

  return (
    <FormSection label={t("keychain.identityForm.sectionLinkedTo")}>
      <div className="space-y-1 p-1">
        {identities.map((i) => (
          <LinkedRow
            key={i.id}
            avatar={<AvatarTile icon="lucide:id-card" iconSize={14} className="rounded-md" style={avatarStyle} />}
            title={i.name || i.username}
            subtitle={i.name ? i.username : ""}
          >
            <RowButton
              icon="lucide:pencil"
              title={t("keychain.identityForm.editIdentityTitle")}
              hoverColor="var(--t-text-bright)"
              onClick={() => open({ kind: "identity-edit", identityId: i.id }, () => setKeychainPendingAction({ action: "edit-identity", id: i.id }))}
            />
          </LinkedRow>
        ))}
        {hosts.map((c) => {
          const displayIcon = c.icon || c.distro;
          const allowed = unlink?.allowed(c) ?? false;
          return (
            <LinkedRow
              key={c.id}
              avatar={(
                <AvatarTile
                  base={(displayIcon && getConnectionIconColor(displayIcon)) || "var(--t-bg-card-avatar)"}
                  icon={(displayIcon && getConnectionIcon(displayIcon)) || "lucide:server"}
                  iconSize={14}
                  className="rounded-md text-white"
                  style={avatarStyle}
                />
              )}
              title={connectionDisplayName(c)}
              subtitle={`${c.username}@${c.host}:${c.port}`}
            >
              <RowButton
                icon="lucide:pencil"
                title={t("keychain.identityForm.editHostTitle")}
                hoverColor="var(--t-text-bright)"
                onClick={() => open({ kind: "host-edit", hostId: c.id }, () => { setActiveNav("hosts"); setHomePendingAction({ action: "edit", id: c.id }); })}
              />
              {unlink && (
                <RowButton
                  icon="lucide:unlink"
                  title={allowed ? t("keychain.identityForm.unlinkTitle") : t("keychain.identityForm.unlinkNoPermission")}
                  hoverColor="var(--t-status-error, #ef4444)"
                  disabled={!allowed}
                  onClick={() => unlink.run(c)}
                />
              )}
            </LinkedRow>
          );
        })}
      </div>
    </FormSection>
  );
}
