import { useState } from "react";
import { revertIfMoveCancelled } from "@/services/teamObjectPersistence";

export function useFolderField(saved: string | null | undefined) {
  const [folderId, setFolderId] = useState<string | null>(saved ?? null);
  const keepSavedOnCancel = (result: void | Promise<void>) =>
    Promise.resolve(result).catch(revertIfMoveCancelled(() => setFolderId(saved ?? null)));
  return { folderId, setFolderId, keepSavedOnCancel };
}
