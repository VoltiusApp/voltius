import { useTranslation } from "react-i18next";
import type { TeamObjectType } from "@/services/teamObjects";
import { accessLevel, hasSecrets, isCredentialType, type AccessLevel } from "./accessSummary";
import { usePreviewObject } from "./PreviewScope";

export function usePreviewLevel(type: TeamObjectType, id: string): AccessLevel | null {
  const object = usePreviewObject(id);
  return object ? accessLevel(object.mask, type) : null;
}

const CHIP = "shrink-0 px-1.5 py-0.5 rounded-md text-[11px] font-semibold border border-(--t-border) bg-(--t-bg-input) text-(--t-text-dim)";

export function PreviewHint({ type, id, layout }: { type: TeamObjectType; id: string; layout: "grid" | "list" }) {
  const { t } = useTranslation();
  const object = usePreviewObject(id);
  if (!object) return null;

  if (layout === "grid") {
    return object.changed
      ? <span className={`${CHIP} text-(--t-accent)`}>{t("members.viewAs.draftBadge")}</span>
      : null;
  }

  const level = (mask: number) => t(`members.viewAs.level.${accessLevel(mask, type)}`);
  return (
    <>
      <span className={CHIP}>{level(object.mask)}</span>
      {isCredentialType(type) && (
        <span className={CHIP}>{t(`members.viewAs.secrets.${hasSecrets(object.mask) ? "yes" : "no"}`)}</span>
      )}
      {object.changed && (
        <span className="shrink-0 text-xs text-(--t-accent)">
          {t("members.viewAs.draftChange", { from: level(object.currentMask), to: level(object.mask) })}
        </span>
      )}
    </>
  );
}
