import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { PresenceAvatar } from "@/components/shared/PresenceAvatar";
import { roleChipColors } from "@/components/members/roleChips";

export type Person = {
  userId: string;
  handle: string;
  roleNames: string[];
  online: boolean;
  state: "member" | "pending" | "awaiting_key";
  invitationId?: string;
  /** X25519 public key, so "Grant now" can wrap the vault key. */
  publicKey?: string;
};

interface Props {
  people: Person[];
  canManage: boolean;
  onRemove: (p: Person) => void;
  onRevoke: (p: Person) => void;
  onGrantKey: (p: Person) => void;
  onCopyInviteLink: (p: Person) => void;
}

export function PeopleList({ people, canManage, onRemove, onRevoke, onGrantKey, onCopyInviteLink }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      {people.map((p) => (
        <div
          key={p.invitationId ?? p.userId}
          className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-(--t-bg-card)"
        >
          {/* Wraps rather than squeezes: at the popover's width, flexing a long
              handle against the chips shredded it into a five-line column. */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <PresenceAvatar handle={p.handle} size={26} online={p.online} />
            {/* No truncation: read before granting access. */}
            <span className="text-xs text-(--t-text-primary) break-all flex-1 basis-32 min-w-0">
              {p.handle}
            </span>

            {p.state === "pending" && (
              <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-dashed border-(--t-border) text-(--t-text-dim)">
                {t("members.people.pending")}
              </span>
            )}

            {p.roleNames.map((name) => {
              const { color, bg } = roleChipColors(name);
              return (
                <span
                  key={name}
                  className="shrink-0 text-[10px] px-2 py-0.5 rounded-full capitalize"
                  style={{ color, background: bg }}
                >
                  {name}
                </span>
              );
            })}

            {p.state === "pending" && (
              <button
                title={t("members.people.copyInviteLink")}
                onClick={() => onCopyInviteLink(p)}
                className="shrink-0 p-1.5 rounded-lg text-(--t-text-dim)"
              >
                <Icon icon="lucide:link" width={14} />
              </button>
            )}

            {canManage && (
              <button
                title={p.state === "pending" ? t("members.people.revoke") : t("members.people.remove")}
                onClick={() => (p.state === "pending" ? onRevoke(p) : onRemove(p))}
                className="shrink-0 p-1.5 rounded-lg"
                style={{ color: "var(--t-status-error)" }}
              >
                <Icon icon="lucide:x" width={14} />
              </button>
            )}
          </div>

          {p.state === "awaiting_key" && (
            <div className="flex items-center gap-2 pl-[2.3rem]">
              <span className="text-[11px] text-(--t-text-secondary) flex-1 min-w-0">
                {t("members.people.awaitingKey")}
              </span>
              {canManage && (
                <button
                  onClick={() => onGrantKey(p)}
                  className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] border border-(--t-border) text-(--t-text-secondary)"
                >
                  {t("members.people.grantKey")}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
