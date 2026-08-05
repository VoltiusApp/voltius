/**
 * Public `@voltius/ui` surface for external plugin bundles.
 * Deliberately minimal — additions require a migration that needs them.
 */
export { Icon } from "@iconify/react";
export { InfoTooltip } from "@/components/shared/InfoTooltip";
export { useAutosave } from "@/hooks/useAutosave";
// Mobile action-sheet chrome (drag-to-dismiss, hardware-back interception, visual-
// viewport tracking) is genuinely non-trivial to reimplement per plugin — exported
// here rather than duplicated across monitoring/docker/proxmox's mobile screens.
export { default as BottomSheet } from "@/components/mobile/sheets/BottomSheet";
export { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
export { ConfirmModal } from "@/components/shared/ConfirmModal";
