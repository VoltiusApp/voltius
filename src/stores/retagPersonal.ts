import { isTeamVaultId } from "@/stores/teamVaultMap";

type Taggable = { id: string; tags: string[]; vault_id?: string };

export const personallyTagged = <T extends Taggable>(items: T[], tag: string): T[] =>
  items.filter((i) => i.tags.includes(tag) && !isTeamVaultId(i.vault_id));

export async function retagPersonal<T extends Taggable, F>(
  items: T[],
  toForm: (item: T) => F,
  update: (id: string, data: F & { tags: string[] }) => Promise<unknown>,
  tag: string,
  rewrite: (tags: string[]) => string[],
): Promise<T[]> {
  const tagged = personallyTagged(items, tag);
  await Promise.all(tagged.map((i) => update(i.id, { ...toForm(i), tags: rewrite(i.tags) })));
  return tagged;
}
