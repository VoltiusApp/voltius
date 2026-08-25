import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import type { UserSearchResult } from "@/hooks/useUserSearch";

interface EmailInviteOption {
  visible: boolean;
  label: ReactNode;
  actionLabel: string;
  sending: boolean;
  onInvite: () => void;
  /** The settings surfaces rule the row off from the results above it. */
  separator?: boolean;
}

interface UserSearchFieldProps {
  /** "md" is the side panels, "sm" the denser settings surfaces. */
  size?: "md" | "sm";
  placeholder: string;
  query: string;
  onQueryChange: (v: string) => void;
  onClear: () => void;
  onSubmitQuery?: () => void;
  results: UserSearchResult[];
  searching: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  adding: string | null;
  addLabel: string;
  onAdd: (user: UserSearchResult) => void;
  /** When set, the dropdown stays open on an empty result set and shows this. */
  emptyLabel?: string;
  emailOption?: EmailInviteOption;
  /** Disables every add/invite action without hiding the dropdown, e.g. while no role is selected. */
  actionsDisabled?: boolean;
}

export function UserSearchField({
  size = "md",
  placeholder, query, onQueryChange, onClear, onSubmitQuery,
  results, searching, open, setOpen,
  inputRef, dropdownRef,
  adding, addLabel, onAdd,
  emptyLabel, emailOption,
  actionsDisabled,
}: UserSearchFieldProps) {
  const md = size === "md";
  const iconWidth = md ? 14 : 13;
  const showEmail = !!emailOption?.visible;
  const showDropdown = open && (results.length > 0 || showEmail || emptyLabel !== undefined);

  return (
    <div className="relative">
      <div
        className={`flex items-center gap-2 px-3 transition-colors border ${md ? "py-2.5 rounded-xl" : "py-2 rounded-lg"}`}
        style={{ background: "var(--t-bg-input)", borderColor: open ? "var(--t-accent)" : "var(--t-border)" }}
      >
        {searching
          ? <Icon icon="lucide:loader-circle" width={iconWidth} className="animate-spin shrink-0 text-(--t-text-dim)" />
          : <Icon icon="lucide:search" width={iconWidth} className="shrink-0 text-(--t-text-dim)" />
        }
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => { if (results.length > 0 || showEmail) setOpen(true); }}
          onKeyDown={onSubmitQuery && ((e) => { if (e.key === "Enter") onSubmitQuery(); })}
          className="flex-1 bg-transparent outline-hidden text-sm text-(--t-text-primary)"
        />
        {query && (
          <button onClick={onClear}>
            <Icon icon="lucide:x" width={11} style={{ color: "var(--t-text-dim)" }} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden"
          style={{ background: "var(--t-bg-card)", boxShadow: "var(--t-ring), var(--t-elev-2)" }}
        >
          {results.length === 0 && emptyLabel !== undefined && !showEmail && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--t-text-dim)" }}>{emptyLabel}</p>
          )}
          {results.map((user) => (
            <button
              key={user.user_id}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
              style={{ color: "var(--t-text-primary)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
              disabled={!!adding || actionsDisabled}
              onClick={() => onAdd(user)}
            >
              <MiniAvatar name={user.handle} size={26} />
              <span className="flex-1 text-sm truncate">{user.handle}</span>
              {adding === user.user_id
                ? <Icon icon="lucide:loader-circle" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                    {addLabel}
                  </span>
              }
            </button>
          ))}
          {showEmail && emailOption && (
            <button
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors${emailOption.separator ? " border-t" : ""}`}
              style={{
                color: "var(--t-text-primary)",
                borderColor: emailOption.separator ? "var(--t-border)" : undefined,
                borderTop: !emailOption.separator && results.length > 0 ? "1px solid var(--t-border)" : undefined,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
              disabled={emailOption.sending || actionsDisabled}
              onClick={emailOption.onInvite}
            >
              <Icon icon="lucide:mail" width={16} className="shrink-0" style={{ color: "var(--t-accent)" }} />
              <span className="flex-1 text-sm">{emailOption.label}</span>
              {emailOption.sending
                ? <Icon icon="lucide:loader-circle" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                    {emailOption.actionLabel}
                  </span>
              }
            </button>
          )}
        </div>
      )}
    </div>
  );
}
