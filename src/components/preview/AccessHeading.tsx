import { useTranslation } from "react-i18next";
import { isMobileShell } from "@/utils/platform";

export function AccessHeading({ title, subtitleOnDesktop = true }: { title: string; subtitleOnDesktop?: boolean }) {
  const { t } = useTranslation();
  const mobile = isMobileShell();
  return (
    <div>
      <p className="text-sm font-semibold text-(--t-text-primary)">{title}</p>
      {(mobile || subtitleOnDesktop) && (
        <p className="text-[11px] text-(--t-text-dim)">
          {t(mobile ? "mobile.viewAs.accessSubtitle" : "members.viewAs.access.subtitle")}
        </p>
      )}
    </div>
  );
}
