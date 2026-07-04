import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import MobileSnippetList from "../MobileSnippetList";

export default function MobileSnippetsSheet({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation();
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  return (
    <BottomSheet title={t("common.entity.snippets")} onClose={closeSheet}>
      <div className="h-[60vh] flex flex-col">
        <MobileSnippetList currentSessionId={sessionId} />
      </div>
    </BottomSheet>
  );
}
