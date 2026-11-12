import { Icon } from "@iconify/react";
import { haptic } from "@/lib/haptics";

export type SheetAction = {
  icon: string;
  label: string;
  /** Test/automation handle. Defaults to a slug derived from the label. */
  slug?: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onTap: () => void;
};

/**
 * One tappable row of a bottom sheet's action list. `attr` is the sheet's own
 * data attribute suffix (`data-host-action`, `data-folder-action`, …) — every
 * sheet had its own byte-identical copy of this button differing only there.
 */
export function SheetActionRow({ attr, it }: { attr: string; it: SheetAction }) {
  const slug = it.slug ?? it.label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <button
      {...{ [`data-${attr}`]: slug }}
      disabled={it.disabled || it.disabledReason !== undefined}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card) disabled:opacity-50"
      style={{ color: it.danger ? "var(--t-danger, #e5484d)" : "var(--t-text-primary)" }}
      onClick={() => {
        // The confirming step of a destructive action (slug `delete-confirm`, …).
        if (it.danger && slug.endsWith("-confirm")) haptic("confirm");
        it.onTap();
      }}
    >
      <Icon icon={it.icon} width={18} />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{it.label}</span>
        {it.disabledReason && <span className="text-xs text-(--t-text-dim)">{it.disabledReason}</span>}
      </span>
    </button>
  );
}
