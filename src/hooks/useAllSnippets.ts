import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useSnippetStore } from "@/stores/snippetStore";
import { useTeamStore } from "@/stores/teamStore";
import { mergeSnippets } from "@/services/import-export/storeAccess";
import type { Snippet } from "@/types";

export function useAllSnippets(): Snippet[] {
  const personal = useSnippetStore((s) => s.snippets);
  const teamMap = useSnippetStore((s) => s.teamSnippets);
  const teamIds = useTeamStore(useShallow((s) => s.teams.map((t) => t.id)));
  return useMemo(() => mergeSnippets(personal, teamMap, teamIds), [personal, teamMap, teamIds]);
}
