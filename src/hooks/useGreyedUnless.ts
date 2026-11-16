import { useTranslation } from "react-i18next";

export interface Greyed {
  disabled: boolean;
  title: string | undefined;
}

/** Props that grey a control out, with the standard reason, unless the subject holds the permission. */
export function useGreyedUnless(): (has: boolean) => Greyed {
  const { t } = useTranslation();
  const reason = t("members.viewAs.lacksPermission");
  return (has) => ({ disabled: !has, title: has ? undefined : reason });
}
