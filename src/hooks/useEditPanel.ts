import { useState } from "react";
import type { TeamObjectType } from "@/services/teamObjects";
import { refuseWhilePreviewing, targetOf } from "@/services/previewGuard";

interface EditPanel<T extends { id: string }> {
  editing: T | "new" | null;
  panelOpen: boolean;
  openEdit: (item: T | "new") => void;
  closeEdit: () => void;
  /** True when the given item's edit panel is currently open */
  isEditing: (item: T) => boolean;
  /**
   * Call after successfully creating a new item (from "new" state).
   * Transitions the panel to edit-existing mode so subsequent autosaves
   * call update rather than create.
   */
  transitionToExisting: (item: T) => void;
}

/**
 * Canonical state management for the "open / create-new / edit-existing" panel
 * pattern shared across HomePage, KeychainPage and SnippetsPage.
 *
 * Usage:
 *   const ep = useEditPanel<Snippet>("snippet");
 *   <SnippetCard isEditing={ep.isEditing(s)} onClick={() => ep.openEdit(s)} />
 *   <SnippetForm
 *     key={ep.editing === "new" ? "__new__" : ep.editing?.id}
 *     initial={ep.editing === "new" ? undefined : ep.editing ?? undefined}
 *     onSubmit={async (data) => {
 *       if (ep.editing === "new") ep.transitionToExisting(await create(data));
 *       else if (ep.editing) await update(ep.editing.id, data);
 *     }}
 *     onClose={ep.closeEdit}
 *   />
 */
export function useEditPanel<T extends { id: string }>(objectType: TeamObjectType): EditPanel<T> {
  const [editing, setEditing] = useState<T | "new" | null>(null);

  return {
    editing,
    panelOpen: editing !== null,
    openEdit: (item) => {
      if (refuseWhilePreviewing(targetOf(objectType)(item === "new" ? undefined : item.id))) return;
      setEditing(item);
    },
    closeEdit: () => setEditing(null),
    isEditing: (item) => editing !== null && editing !== "new" && editing.id === item.id,
    transitionToExisting: (item) => setEditing(item),
  };
}
