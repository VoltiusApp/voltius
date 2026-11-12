import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useLockNudgeStore } from "@/stores/lockNudgeStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useSessionsLocked } from "@/hooks/useSessionLocked";

export type TabCloseVariant = "tab" | "pane" | "row" | "chip" | "badge";

export const UNLOCK_ARM_MS = 450;

const SIZES: Record<TabCloseVariant, { x: number; lock: number }> = {
  tab: { x: 20, lock: 16 },
  pane: { x: 14, lock: 13 },
  row: { x: 14, lock: 14 },
  chip: { x: 12, lock: 12 },
  badge: { x: 10, lock: 10 },
};

const X_CLASS: Record<TabCloseVariant, string> = {
  tab: "ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm p-0.5 [&_path]:stroke-[2.1] hover:text-(--t-status-error)!",
  pane: "h-full px-1.5 flex items-center justify-center hover:bg-(--t-bg-card-hover) transition-colors text-(--t-text-dim) hover:text-(--t-status-error)",
  row: "p-1 rounded-sm text-(--t-text-muted) hover:text-(--t-status-error)",
  chip: "vt-hit opacity-70 h-8 w-8 rounded-full flex items-center justify-center",
  badge: "hidden",
};

const LOCK_CLASS: Record<TabCloseVariant, string> = {
  tab: "ml-0.5 inline-flex items-center justify-center size-6 rounded-sm transition-colors hover:bg-(--t-bg-card-hover) hover:text-(--t-text-primary)!",
  pane: "h-full px-1.5 flex items-center justify-center hover:bg-(--t-bg-card-hover) transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)",
  row: "p-1 rounded-sm text-(--t-text-muted) hover:text-(--t-text-primary)",
  chip: "vt-hit h-8 w-8 rounded-full flex items-center justify-center opacity-85",
  badge: "absolute -right-1.5 -bottom-1 inline-flex p-0.5 rounded-full bg-(--t-bg-terminal) hover:text-(--t-text-primary)!",
};

function useWiggle(lockIds: string[], locked: boolean): [boolean, () => void] {
  const nonce = useLockNudgeStore((s) => s.nonce);
  const [wiggle, setWiggle] = useState(false);
  const seen = useRef(nonce);
  useEffect(() => {
    if (nonce === seen.current) return;
    seen.current = nonce;
    if (locked && useLockNudgeStore.getState().ids.some((id) => lockIds.includes(id))) setWiggle(true);
  }, [nonce, locked, lockIds]);
  return [wiggle, () => setWiggle(false)];
}

export function TabCloseControl({
  variant,
  sessionIds,
  active = false,
  closeTitle,
  onClose,
}: {
  variant: TabCloseVariant;
  sessionIds: string[];
  active?: boolean;
  closeTitle: string;
  onClose: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const locked = useSessionsLocked(sessionIds);
  const [hover, setHover] = useState(false);
  const [disarmed, setDisarmed] = useState(false);
  const [wiggle, endWiggle] = useWiggle(sessionIds, locked);
  const size = SIZES[variant];
  const Tag = variant === "tab" || variant === "badge" ? "span" : "button";
  const tint = variant === "tab" || variant === "badge"
    ? { color: active ? "var(--t-tab-active-text)" : "var(--t-text-muted)" }
    : undefined;

  useEffect(() => {
    if (!disarmed) return;
    const timer = setTimeout(() => setDisarmed(false), UNLOCK_ARM_MS);
    return () => clearTimeout(timer);
  }, [disarmed]);

  if (locked) {
    return (
      <Tag
        role="button"
        title={t("layout.titleBar.lock.unlockHint")}
        aria-label={t("layout.titleBar.lock.unlockHint")}
        className={`${LOCK_CLASS[variant]} ${wiggle ? "animate-tab-lock-wiggle" : ""}`}
        style={tint}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
        onAnimationEnd={endWiggle}
        onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          setHover(false);
          setDisarmed(true);
          useSessionStore.getState().setSessionsLocked(sessionIds, false);
        }}
      >
        <Icon icon={hover ? "lucide:lock-open" : "lucide:lock"} width={size.lock} />
      </Tag>
    );
  }

  if (variant === "badge") return null;

  return (
    <Tag
      role="button"
      title={closeTitle}
      aria-label={closeTitle}
      className={`${X_CLASS[variant]} ${disarmed ? "opacity-35! cursor-default" : ""}`}
      style={tint}
      onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        if (!disarmed) onClose(e);
      }}
    >
      <Icon icon="lucide:x" width={size.x} />
    </Tag>
  );
}
