import { Icon } from "@iconify/react";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useRipple } from "@/hooks/useRipple";
import { getAccountMode, lockVaultSession, logout } from "@/services/account";
import { getSavedAccounts, saveCurrentAccount, switchToAccount, removeSavedAccount, type SavedAccount } from "@/services/savedAccounts";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";

export function SidebarAccountButton() {
  const { t } = useTranslation();
  const { createRipple, rippleEls } = useRipple();
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const uiScale = useUIStore((s) => s.uiScale);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });
  const [accountMode, setAccountMode] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);

  const refreshAccountInfo = async () => {
    const { invoke: inv } = await import("@tauri-apps/api/core");
    const [mode, email, accountId] = await Promise.all([
      getAccountMode().catch(() => null),
      inv<string | null>("keychain_get", { key: "email" }).catch(() => null),
      inv<string | null>("keychain_get", { key: "account_id" }).catch(() => null),
    ]);
    setAccountMode(mode);
    setAccountEmail(email);
    setCurrentAccountId(accountId);
  };

  useEffect(() => { refreshAccountInfo(); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const openDropdown = async () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ bottom: window.innerHeight - rect.bottom, left: rect.right + 8 });
    }
    await Promise.all([refreshAccountInfo(), saveCurrentAccount().catch(() => {})]);
    const accounts = await getSavedAccounts().catch(() => [] as SavedAccount[]);
    setSavedAccounts(accounts);
    setOpen((o) => !o);
  };

  const handleLockVault = async () => {
    setOpen(false);
    await lockVaultSession();
    window.location.reload();
  };

  const handleDisconnect = async () => {
    setOpen(false);
    await logout();
    window.location.reload();
  };

  const handleSwitchAccount = async (account: SavedAccount) => {
    setOpen(false);
    await switchToAccount(account);
  };

  const handleRemoveSavedAccount = async (e: React.MouseEvent, account_id: string) => {
    e.stopPropagation();
    await removeSavedAccount(account_id);
    setSavedAccounts((prev) => prev.filter((a) => a.account_id !== account_id));
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => void openDropdown()}
        onMouseDown={createRipple}
        title={t("layout.sidebarAccount.accountTitle")}
        className="flex items-center justify-center relative overflow-hidden transition-all shrink-0"
        style={{
          width: 44,
          height: 44,
          borderRadius: open ? "0.75rem" : "1.375rem",
          background: open ? "var(--t-bg-elevated)" : "transparent",
          color: open ? "var(--t-text-bright)" : "var(--t-text-dim)",
          transition: "border-radius 200ms, background 200ms, color 200ms",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderRadius = "0.75rem";
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)";
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.borderRadius = "1.375rem";
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
          }
        }}
      >
        {rippleEls}
        <Icon icon="lucide:circle-user" width={18} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="surface-float fixed p-1.5 z-9999 flex flex-col min-w-56"
          style={{
            bottom: pos.bottom,
            left: pos.left,
            transform: `scale(${uiScale})`,
            transformOrigin: "bottom left",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(accountEmail || accountMode) && (
            <>
              <div className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <Icon icon="lucide:circle-user" width={16} style={{ color: "var(--t-text-dim)" }} />
                  <span className="text-sm font-medium truncate" style={{ color: "var(--t-text-primary)" }}>
                    {accountEmail ?? t("layout.sidebarAccount.localAccountFallback")}
                  </span>
                </div>
                {accountMode && (
                  <span className="text-xs mt-0.5 block" style={{ color: "var(--t-text-dim)" }}>
                    {accountMode === "server" ? t("layout.sidebarAccount.modeCloud") : accountMode === "local" ? t("layout.sidebarAccount.modeLocalPassword") : t("layout.sidebarAccount.modeLocal")}
                  </span>
                )}
              </div>
              <div className="h-px bg-(--t-bg-input) -mx-1.5 my-0.5" />
            </>
          )}

          <DropdownMenuItem icon="lucide:lock" label={t("layout.sidebarAccount.lockVault")} onClick={() => void handleLockVault()} />

          <DropdownMenuItem
            icon="lucide:bug"
            label={t("layout.sidebarAccount.reportBug")}
            onClick={() => { setOpen(false); useUIStore.getState().openSettings("diagnostics"); }}
          />

          <DropdownMenuItem
            icon="lucide:palette"
            label={t("layout.sidebarAccount.appearance")}
            onClick={() => { setOpen(false); useUIStore.getState().openSettings("appearance"); }}
          />
          <DropdownMenuItem
            icon="lucide:sun-moon"
            label={t("layout.sidebarAccount.toggleTheme")}
            onClick={() => { setOpen(false); useThemeStore.getState().toggleLightDark(); }}
          />

          {accountMode !== "server" && (
            <DropdownMenuItem
              icon="lucide:log-in"
              label={t("layout.sidebarAccount.signInSignUp")}
              onClick={() => { openCloudAuth("signin"); setOpen(false); }}
            />
          )}

          {accountMode === "server" && (
            <DropdownMenuItem icon="lucide:log-out" label={t("common.action.disconnect")} onClick={() => void handleDisconnect()} />
          )}

          {savedAccounts.length > 1 && (
            <>
              <div className="h-px bg-(--t-bg-input) -mx-1.5 my-0.5" />
              <div className="px-3 pt-2 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-text-dim)" }}>
                  {t("layout.sidebarAccount.switchAccount")}
                </span>
              </div>
              {savedAccounts
                .filter((a) => a.account_id !== currentAccountId)
                .map((account) => (
                  <button
                    key={account.account_id}
                    type="button"
                    onClick={() => void handleSwitchAccount(account)}
                    className="group flex items-center gap-2.5 p-2.5 rounded-lg text-sm transition-colors w-full text-left"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                  >
                    <Icon icon="lucide:circle-user" width={16} style={{ color: "var(--t-text-dim)" }} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium" style={{ color: "var(--t-text-primary)" }}>{account.display}</div>
                      <div className="text-[10px]" style={{ color: "var(--t-text-dim)" }}>{account.mode === "server" ? t("layout.sidebarAccount.savedAccountCloud") : t("layout.sidebarAccount.savedAccountLocal")}</div>
                    </div>
                    <button
                      type="button"
                      title={t("layout.sidebarAccount.removeSavedAccount")}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded-sm transition-opacity"
                      style={{ color: "var(--t-text-dim)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
                      onClick={(e) => void handleRemoveSavedAccount(e, account.account_id)}
                    >
                      <Icon icon="lucide:x" width={12} />
                    </button>
                  </button>
                ))}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
