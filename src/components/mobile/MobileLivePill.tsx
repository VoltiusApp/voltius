import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { getScrollOffset, getTerminalApi, subscribeTerminalScroll } from "@/hooks/useTerminal";
import { haptic } from "@/lib/haptics";

/** Chips floating over the terminal canvas (this pill, the double-tap Tab hint). */
export const TERMINAL_CHIP_STYLE: React.CSSProperties = {
  background: "color-mix(in srgb, var(--t-bg-base) 80%, #000 20%)",
  color: "var(--t-text-bright)", border: "1px solid var(--t-border)",
};

/** Shown while the terminal is scrolled up into its history; one tap returns to the live prompt. */
export default function MobileLivePill({ sessionId }: { sessionId: string }) {
  const [scrolledUp, setScrolledUp] = useState(() => getScrollOffset(sessionId) > 0);
  useEffect(() => {
    const check = () => setScrolledUp(getScrollOffset(sessionId) > 0);
    check();
    return subscribeTerminalScroll(check);
  }, [sessionId]);
  if (!scrolledUp) return null;
  return <LivePillButton onPress={() => { haptic("key"); getTerminalApi(sessionId)?.scrollToBottom(); }} />;
}

export function LivePillButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button data-mobile-live-pill
      className="absolute bottom-3 right-3 pointer-events-auto flex items-center gap-1.5 h-9 pl-3 pr-3.5 rounded-full text-xs font-semibold"
      style={{ ...TERMINAL_CHIP_STYLE, boxShadow: "var(--t-elev-2)" }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}>
      <Icon icon="lucide:arrow-down-to-line" width={15} />
      {t("mobile.terminalGestures.jumpToBottom")}
    </button>
  );
}
