import { useTranslation } from "react-i18next";
import MobilePanelHeader from "../panels/MobilePanelHeader";

export default function MobileMembersScreen({ vaultId }: { vaultId: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)" data-mobile-members={vaultId ?? ""}>
      <MobilePanelHeader title={t("mobile.morePages.members")} />
    </div>
  );
}
