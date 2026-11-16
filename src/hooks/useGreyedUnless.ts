import { useTranslation } from "react-i18next";
import { usePreviewActive } from "@/hooks/previewScope";

export interface Greyed {
  disabled: boolean;
  title: string | undefined;
}

export const GREYED_CLASS = "disabled:opacity-50 disabled:cursor-not-allowed";

const LACK_KEYS = {
  preview: { any: "members.viewAs.lacksPermission", edit: "members.viewAs.cannotEdit" },
  own: { any: "members.permissions.youLack", edit: "members.permissions.youCannotEdit" },
} as const;

/** Why a control is unavailable: about the previewed member inside a preview, about the viewer outside it. */
export function useLackReason(action: "any" | "edit" = "any"): string {
  const { t } = useTranslation();
  return t(LACK_KEYS[usePreviewActive() ? "preview" : "own"][action]);
}

/** Props that grey a control out, with the standard reason, unless the subject holds the permission. */
export function useGreyedUnless(): (has: boolean) => Greyed {
  const reason = useLackReason();
  return (has) => ({ disabled: !has, title: has ? undefined : reason });
}
