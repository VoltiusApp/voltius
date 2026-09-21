import { useTranslation } from "react-i18next";
import { MobileScreenHeader } from "./MobileScreenHeader";

/** Edit-screen variant of MobileScreenHeader: back arrow plus the screen's save button. */
export default function MobileEditHeader({
  title, onBack, onSave, saveAttr, saveDisabled = false,
}: {
  title: string;
  onBack: () => void;
  onSave: () => void;
  saveAttr: string;
  saveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <MobileScreenHeader title={title} onBack={onBack}>
      <button
        {...{ [`data-${saveAttr}`]: true }}
        onClick={onSave}
        disabled={saveDisabled}
        className="px-3 py-1.5 rounded-lg text-sm font-semibold"
        style={{ background: "var(--t-accent)", color: "#fff", opacity: saveDisabled ? 0.5 : 1 }}
      >
        {t("common.action.save")}
      </button>
    </MobileScreenHeader>
  );
}
