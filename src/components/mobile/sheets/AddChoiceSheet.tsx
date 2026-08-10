import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";

const Row = (it: SheetAction) => <SheetActionRow attr="add-choice" it={it} />;

export default function AddChoiceSheet({
  newItemLabel, newItemIcon, onNewItem, onNewFolder, onClose,
}: {
  newItemLabel: string;
  newItemIcon: string;
  onNewItem: () => void;
  onNewFolder: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet title={t("common.action.add")} onClose={onClose} registerBack={false}>
      <Row slug="item" icon={newItemIcon} label={newItemLabel} onTap={onNewItem} />
      <Row slug="folder" icon="lucide:folder-plus" label={t("mobile.snippets.newFolderTitle")} onTap={onNewFolder} />
    </BottomSheet>
  );
}
