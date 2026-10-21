import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { MobileTab } from "@/stores/mobileNavCore";
import { useSlideAway } from "@/hooks/pageTransition";
import { transition } from "@/lib/motion";

function getTabs(t: TFunction): { id: MobileTab; label: string; icon: string }[] {
  return [
    { id: "hosts",    label: t("common.entity.hosts"),  icon: "lucide:server" },
    { id: "terminal", label: t("mobile.tabBar.terminal"), icon: "lucide:square-terminal" },
    { id: "snippets", label: t("common.entity.snippets"), icon: "lucide:braces" },
    { id: "sftp",     label: t("mobile.tabBar.sftp"),    icon: "lucide:folder-closed" },
    { id: "more",     label: t("mobile.tabBar.more"),    icon: "lucide:layout-grid" },
  ];
}

/** M3 active indicator: tinted from the theme accent, grows from the centre. */
const INDICATOR_BG = "color-mix(in srgb, var(--t-accent) 24%, transparent)";
const INDICATOR_TRANSITION = [transition("transform", "medium1", "emphasized"), transition("opacity", "short3", "standard")].join(", ");

/**
 * Material 3 navigation bar: 80 dp + the bottom safe area, labels always on, a pill
 * indicator behind the active icon. `visible` false slides it off the bottom edge
 * (pushed page, immersive terminal) instead of dropping it in one frame.
 */
export default function BottomTabBar({ visible = true }: { visible?: boolean }) {
  const { t } = useTranslation();
  const TABS = getTabs(t);
  const tab = useMobileNavStore((s) => s.tab);
  const setTab = useMobileNavStore((s) => s.setTab);
  const sessionCount = useSessionStore((s) => s.sessions.length);
  const { phase, ref } = useSlideAway<HTMLElement>(visible);
  if (phase === "hidden") return null;
  // While it slides it floats over the shell's bottom edge (above pushed pages, under
  // sheets), so the content resizes once instead of following the bar every frame.
  const sliding = phase === "hiding" || phase === "showing";

  return (
    <nav
      ref={ref}
      data-mobile-tab-bar={phase}
      className="shrink-0 flex"
      style={{
        background: "var(--t-bg-chrome)",
        height: "calc(80px + var(--vt-safe-bottom))",
        paddingBottom: "var(--vt-safe-bottom)",
        ...(sliding && { position: "absolute", left: "var(--vt-safe-left)", right: "var(--vt-safe-right)", bottom: 0, zIndex: 35 }),
        ...(phase === "hiding" && { pointerEvents: "none" }),
      }}
    >
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            data-mobile-tab={t.id}
            data-active={active || undefined}
            aria-current={active ? "page" : undefined}
            onClick={() => setTab(t.id)}
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 relative"
            style={{ color: active ? "var(--t-text-bright)" : "var(--t-text-dim)" }}
          >
            <span className="relative w-16 h-8 flex items-center justify-center">
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                data-mobile-tab-indicator
                style={{
                  background: INDICATOR_BG,
                  transform: active ? "none" : "scaleX(0)",
                  opacity: active ? 1 : 0,
                  transition: INDICATOR_TRANSITION,
                }}
              />
              <span className="relative" style={{ color: active ? "var(--t-accent)" : undefined }}>
                <Icon icon={t.icon} width={24} />
                {t.id === "terminal" && sessionCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center"
                    style={{ background: "var(--t-accent)", color: "var(--t-on-accent)" }}
                  >
                    {sessionCount}
                  </span>
                )}
              </span>
            </span>
            <span className={`text-[12px] leading-4 truncate max-w-full px-1 ${active ? "font-semibold" : "font-medium"}`}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
