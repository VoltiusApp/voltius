import { useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import type { MorePage } from "@/stores/mobileNavCore";
import { usePermissions } from "@/hooks/usePermission";
import { usePreviewActive } from "@/hooks/previewScope";
import { useSelectedAuditContext } from "@/hooks/useAuditContext";
import { previewAreaLock } from "@/components/preview/previewAreaLocks";
import { appToast } from "@/services/appToast";
import { PORT_FORWARDING_ICON } from "@/lib/conceptIcons";

type TabArea = "hosts" | "snippets";
export type MobileViewAsArea = TabArea | Exclude<MorePage, "known-hosts">;

const AREAS: { area: MobileViewAsArea; label: string; icon: string }[] = [
  { area: "hosts", label: "hosts", icon: "lucide:server" },
  { area: "keychain", label: "keychain", icon: "lucide:key-round" },
  { area: "snippets", label: "snippets", icon: "lucide:braces" },
  { area: "port-forwarding", label: "portForwarding", icon: PORT_FORWARDING_ICON },
  { area: "sessions", label: "sessions", icon: "lucide:radio-tower" },
  { area: "members", label: "members", icon: "lucide:users-round" },
  { area: "logs", label: "logs", icon: "lucide:scroll-text" },
];

const isTabArea = (area: MobileViewAsArea): area is TabArea => area === "hosts" || area === "snippets";

export default function MobileViewAsAreas() {
  const { t } = useTranslation();
  const previewing = usePreviewActive();
  const can = usePermissions();
  const auditContext = useSelectedAuditContext();
  const tab = useMobileNavStore((s) => s.tab);
  const stack = useMobileNavStore((s) => s.stack);
  const { setTab, push } = useMobileNavStore.getState();
  const rowRef = useRef<HTMLDivElement>(null);
  const top = stack[stack.length - 1];
  const active = top?.kind === "more-page" ? top.page : stack.length === 0 && (tab === "hosts" || tab === "snippets") ? tab : null;
  useEffect(() => {
    rowRef.current?.querySelector("[aria-current]")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active, previewing]);
  if (!previewing) return null;

  const lockOf = (area: MobileViewAsArea) =>
    area === "logs" || area === "sessions"
      ? previewAreaLock({ area, previewing: true, can, auditContext, vaultId: previewing.vaultId })
      : null;

  const open = (area: MobileViewAsArea) => {
    const reason = lockOf(area);
    if (reason) return appToast("info", t(reason));
    if (isTabArea(area)) return setTab(area);
    setTab("more");
    push({ kind: "more-page", page: area });
  };

  return (
    <div ref={rowRef} data-mobile-view-as-areas className="shrink-0 flex overflow-x-auto scrollbar-none px-2" style={{ background: "var(--t-bg-chrome)" }}>
      {AREAS.map(({ area, label, icon }) => {
        const locked = lockOf(area) !== null;
        const isActive = active === area;
        return (
          <button
            key={area}
            data-view-as-area={area}
            aria-disabled={locked || undefined}
            aria-current={isActive || undefined}
            className="shrink-0 flex items-center justify-center px-1"
            style={{ height: 48 }}
            onClick={() => open(area)}
          >
            <span
              className="flex items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap"
              style={{
                height: 32,
                opacity: locked ? 0.5 : 1,
                color: isActive ? "var(--t-text-primary)" : "var(--t-text-dim)",
                background: isActive ? "color-mix(in srgb, var(--t-accent) 24%, transparent)" : "transparent",
                border: "1px solid var(--t-border)",
              }}
            >
              <Icon icon={locked ? "lucide:lock" : icon} width={14} />
              {t(`mobile.viewAs.areas.${label}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
