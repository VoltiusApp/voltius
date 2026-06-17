import { useState } from "react";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import MobileHeader from "../MobileHeader";
import MobileSnippetList from "../MobileSnippetList";
import AddChoiceSheet from "../sheets/AddChoiceSheet";

export default function MobileSnippetsScreen() {
  const push = useMobileNavStore((s) => s.push);
  const [addMenu, setAddMenu] = useState(false);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader onAdd={() => setAddMenu(true)} />
      <MobileSnippetList addFolderOpen={addFolderOpen} onCloseAddFolder={() => setAddFolderOpen(false)} />
      {addMenu && (
        <AddChoiceSheet
          newItemLabel="New snippet"
          newItemIcon="lucide:braces"
          onNewItem={() => { setAddMenu(false); push({ kind: "snippet-edit" }); }}
          onNewFolder={() => { setAddMenu(false); setAddFolderOpen(true); }}
          onClose={() => setAddMenu(false)}
        />
      )}
    </div>
  );
}
