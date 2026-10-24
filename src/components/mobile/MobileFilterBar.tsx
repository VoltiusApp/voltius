import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

/**
 * The one search / filter field for mobile: the M3 search bar (48 dp, fully rounded,
 * tonal fill, no outline). Every mobile search uses it — top-level lists, sheets and
 * plugin screens — so search always reads as the same control, distinct from the 8 px
 * outlined form fields. `inset` is the padding around the bar (sheets bring their own
 * gutter); `attr` names the data hooks (`data-<attr>` on the input, `data-<attr>-clear`
 * on the clear button); `trailing` sits before the clear button (e.g. a result count).
 */
export default function MobileFilterBar({
  value, onChange, placeholder, attr = "mobile-filter", clearLabel, autoFocus, trailing,
  inset = "px-4 py-2", className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  attr?: string;
  clearLabel?: string;
  autoFocus?: boolean;
  trailing?: ReactNode;
  inset?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const effectivePlaceholder = placeholder ?? t("mobile.filterBar.placeholder");
  return (
    <div className={`${inset} shrink-0 ${className}`}>
      <div className="flex items-center gap-3 px-4 h-12 rounded-full" style={{ background: "var(--t-bg-card)" }}>
        <Icon icon="lucide:search" width={20} className="text-(--t-text-dim) shrink-0" />
        <input
          {...{ [`data-${attr}`]: "" }}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={effectivePlaceholder}
          aria-label={effectivePlaceholder}
          className="flex-1 min-w-0 self-stretch bg-transparent outline-none text-base text-(--t-text-primary) placeholder:text-(--t-text-dim)"
        />
        {trailing}
        {value && (
          <button
            {...{ [`data-${attr}-clear`]: "" }}
            onClick={() => onChange("")}
            aria-label={clearLabel ?? t("mobile.hostsScreen.clearSearchAriaLabel")}
            className="vt-icon-btn -mr-3 text-(--t-text-dim) active:text-(--t-text-primary)"
          >
            <Icon icon="lucide:x" width={20} />
          </button>
        )}
      </div>
    </div>
  );
}
