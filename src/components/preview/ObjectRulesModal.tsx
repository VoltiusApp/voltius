import { Modal, ModalCard } from "@/components/shared/Modal";
import { PermissionsSection } from "@/components/permissions/PermissionsSection";
import type { TeamObjectType } from "@/services/teamObjects";
import { CloseButton } from "./CloseButton";

interface ObjectRulesModalProps {
  objectId: string;
  type: TeamObjectType;
  vaultId: string;
  title: string;
  onClose: () => void;
}

export function ObjectRulesModal({ objectId, type, vaultId, title, onClose }: ObjectRulesModalProps) {
  return (
    <Modal onClose={onClose}>
      <ModalCard solid className="p-5 flex flex-col gap-3 max-h-[90dvh] overflow-y-auto" style={{ width: "min(30rem, 94vw)" }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-(--t-text-bright)">{title}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <PermissionsSection objectId={objectId} vaultId={vaultId} type={type} controlAuthority />
      </ModalCard>
    </Modal>
  );
}
