import type { Snippet, SnippetFormData } from "@/types";

/** Snippet → editable form data (for duplicate / move / copy-to-vault). */
export function snippetToForm(s: Snippet): SnippetFormData {
  return {
    name: s.name,
    steps: s.steps,
    description: s.description,
    tags: s.tags,
    folder_id: s.folder_id,
    favorite: s.favorite,
    only_for_connection_tags: s.only_for_connection_tags,
    only_for_distros: s.only_for_distros,
    vault_id: s.vault_id,
  };
}
