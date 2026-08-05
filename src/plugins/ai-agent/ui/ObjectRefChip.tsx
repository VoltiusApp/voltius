import { useTranslation } from "react-i18next";
import { ConnectionAvatar } from "@voltius/ui";
import type { ObjectRef } from "../state/objectRefs";

/** Inline pill for an object reference (prose, plan steps, tool detail). */
export function ObjectRefChip({ refObj, id }: { refObj: ObjectRef | null; id: string }) {
  const { t } = useTranslation();
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
    </span>
  );
}
