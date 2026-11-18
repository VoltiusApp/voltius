import { useTranslation } from "react-i18next";
import { EmptyState, type EmptyStateAction } from "@/components/shared/EmptyState";

/** An open folder with nothing of the page's types in it. */
export function FolderEmptyState({ actions }: { actions: EmptyStateAction[] }) {
  const { t } = useTranslation();
  return <EmptyState size="section" icon="lucide:folder-open" title={t("folders.empty")} action={actions} />;
}
