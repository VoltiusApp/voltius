import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";

export default function AddChoiceSheet({
  newItemLabel, newItemIcon, onNewItem, onNewFolder, onClose,
}: {
  newItemLabel: string;
  newItemIcon: string;
  onNewItem: () => void;
  onNewFolder: () => void;
  onClose: () => void;
}) {
  const Row = ({ icon, label, onTap, slug }: { icon: string; label: string; onTap: () => void; slug: string }) => (
    <button
      data-add-choice={slug}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card) text-(--t-text-primary)"
      onClick={onTap}
    >
      <Icon icon={icon} width={18} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
  return (
    <BottomSheet title="Add" onClose={onClose} registerBack={false}>
      <Row slug="item" icon={newItemIcon} label={newItemLabel} onTap={onNewItem} />
      <Row slug="folder" icon="lucide:folder-plus" label="New folder" onTap={onNewFolder} />
    </BottomSheet>
  );
}
