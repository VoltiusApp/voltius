import { Icon } from "@iconify/react";
import { greyedTapProps } from "./tapOrExplain";

export default function MobileFab({
  attr, icon, label, extended, onTap, disabledReason,
}: { attr: string; icon: string; label: string; extended: boolean; onTap: () => void; disabledReason?: string | null }) {
  return (
    <button
      {...{ [`data-${attr}`]: "" }}
      data-mobile-fab={extended ? "extended" : "collapsed"}
      data-snackbar-avoid
      aria-label={label}
      {...greyedTapProps(disabledReason, onTap)}
      className="absolute right-4 bottom-4 z-10 h-14 flex items-center pl-4 rounded-2xl text-sm font-medium shadow-[0_6px_16px_-6px_rgba(0,0,0,0.5)] transition-[padding] duration-(--vt-dur-medium2) ease-(--vt-ease-emphasized) aria-disabled:opacity-45"
      style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)", paddingRight: extended ? 20 : 16 }}
    >
      <Icon icon={icon} width={24} className="shrink-0" />
      <span
        aria-hidden
        className="overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin-left] duration-(--vt-dur-medium2) ease-(--vt-ease-emphasized)"
        style={{ maxWidth: extended ? 200 : 0, opacity: extended ? 1 : 0, marginLeft: extended ? 12 : 0 }}
      >
        {label}
      </span>
    </button>
  );
}
