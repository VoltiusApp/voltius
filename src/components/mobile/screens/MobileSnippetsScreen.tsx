import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useVaultScope } from "@/hooks/useVaultScope";
import { usePermissions } from "@/hooks/usePermission";
import MobileHeader from "../MobileHeader";
import MobileSnippetList from "../MobileSnippetList";
import AddChoiceSheet from "../sheets/AddChoiceSheet";

export default function MobileSnippetsScreen() {
  const { t } = useTranslation();
  const push = useMobileNavStore((s) => s.push);
  const { createVaultId } = useVaultScope();
  const can = usePermissions();
  const canCreateSnippet = can("EDIT_SNIPPETS", createVaultId);
  const canCreateFolder = can("EDIT_FOLDERS", createVaultId);
  const [addMenu, setAddMenu] = useState(false);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader onAdd={canCreateSnippet || canCreateFolder ? () => setAddMenu(true) : undefined} />
      <MobileSnippetList addFolderOpen={addFolderOpen} onCloseAddFolder={() => setAddFolderOpen(false)} />
      {addMenu && (
        <AddChoiceSheet
          items={canCreateSnippet ? [{ slug: "item", icon: "lucide:braces", label: t("mobile.snippetsScreen.newSnippetLabel"), onTap: () => { setAddMenu(false); push({ kind: "snippet-edit" }); } }] : []}
          onNewFolder={canCreateFolder ? () => { setAddMenu(false); setAddFolderOpen(true); } : undefined}
          onClose={() => setAddMenu(false)}
        />
      )}
    </div>
  );
}
