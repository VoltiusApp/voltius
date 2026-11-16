import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getMyHandle } from "@/services/account";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { cardGridProps } from "@/components/shared/cardGrid";
import type { LayoutMode } from "@/components/shared/ToolbarViewControls";
import { SelfCard } from "./SelfCard";
import { SignInToCloudCTA, UpgradeToTeamsCTA } from "@/components/members/panels/MembersCTA";

export type PrivateVaultGate = "signIn" | "upgrade" | "noUser" | "ready";

export function privateVaultGate(s: { accountMode: string | null; ownsTeamsPlan: boolean; myUserId: string }): PrivateVaultGate {
  if (s.accountMode !== "server") return "signIn";
  if (!s.ownsTeamsPlan) return "upgrade";
  return s.myUserId ? "ready" : "noUser";
}

/** null while loading; "" when the keychain has no handle and no server to ask (never rejects). */
export function useMyHandle(): string | null {
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => {
    getMyHandle().then(setHandle).catch(() => setHandle(""));
  }, []);
  return handle;
}

export function PrivateVaultMembers({ header, handle, myUserId, layoutMode, children }: {
  header?: ReactNode;
  children?: ReactNode;
  handle: string | null;
  myUserId: string;
  layoutMode: LayoutMode;
}) {
  const { t } = useTranslation();
  const { ownsTeamsPlan, accountMode } = useSubscriptionStore();
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const gate = privateVaultGate({ accountMode, ownsTeamsPlan, myUserId });

  if (gate !== "ready") {
    return (
      <div className="flex-1 flex flex-col bg-(--t-bg-base)">
        {header}
        {gate === "signIn" && <SignInToCloudCTA onSignIn={() => openCloudAuth("signin")} />}
        {gate === "upgrade" && <UpgradeToTeamsCTA />}
        {gate === "noUser" && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Icon icon="lucide:users-round" width={28} style={{ color: "var(--t-text-dim)" }} />
            <p className="text-sm text-(--t-text-dim)">{t("members.empty.signInToInvite")}</p>
          </div>
        )}
      </div>
    );
  }

  if (children) return <>{header}{children}</>;

  return (
    <div className="flex-1 flex flex-col chrome-canvas">
      {header}
      <div className="flex-1 overflow-y-auto px-9 pt-5 pb-9">
        <div className="mb-6">
          <SectionHeader label={t("members.heading.members")} count={1} />
          <div {...cardGridProps(layoutMode, "compact")}>
            <SelfCard handle={handle} layoutMode={layoutMode} />
          </div>
        </div>
      </div>
    </div>
  );
}
