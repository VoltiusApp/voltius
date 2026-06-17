import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useTeamStore } from "@/stores/teamStore";
import type { Folder } from "@/types";

export function useAllSnippetFolders(): Folder[] {
  const personal = useSnippetFolderStore((s) => s.folders);
  const teamMap = useSnippetFolderStore((s) => s.teamSnippetFolders);
  const teamIds = useTeamStore(useShallow((s) => s.teams.map((t) => t.id)));
  return useMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of personal) map.set(f.id, f);
    for (const id of teamIds) for (const f of teamMap[id] ?? []) map.set(f.id, f);
    return [...map.values()];
  }, [personal, teamMap, teamIds]);
}
