import { useT } from "../useT";
import { ConnectionAvatar } from "@voltius/ui";
import type { ObjectRef } from "../state/objectRefs";

/** Inline pill for an object reference (prose, plan steps, tool detail). */
export function ObjectRefChip({ refObj, id }: { refObj: ObjectRef | null; id: string }) {
  const { t } = useT();
  if (!refObj) {
    return (
      <span
        title={id}
        className="inline-flex items-center gap-1 align-middle rounded-md px-1.5 py-0.5 text-[11px] bg-(--t-bg-elevated) border border-(--t-border) text-(--t-text-dim)"
      >
        {t("aiAgent.objectRef.unknown")}
      </span>
    );
  }
  return (
    <span
      title={refObj.detail}
      className="inline-flex items-center gap-1 align-middle rounded-md px-1.5 py-0.5 text-[11px] bg-(--t-bg-elevated) border border-(--t-border) text-(--t-text-bright)"
    >
      <ConnectionAvatar connection={refObj.connection} size={14} />
      <span className="truncate max-w-[16rem]">{refObj.name}</span>
      {/* Shown only when the name is shared, so the common case stays a bare
          name — the detail is what tells two same-named hosts apart. */}
      {refObj.ambiguous && (
        <span className="truncate max-w-[16rem] text-(--t-text-dim)">{refObj.detail}</span>
      )}
    </span>
  );
}
