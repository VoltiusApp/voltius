/**
 * Where a vault object is filed, on every projection that returns one.
 *
 * `object_move` and `object_copy` can relocate objects, but before this nothing
 * could observe the result: the tool surface returned neither field, so a client
 * that moved something had no way to confirm where it landed.
 *
 * Both are normalized the way the rest of the app reads them, so the values
 * round-trip straight back into `object_move`'s arguments and compare against
 * `vault_list` ids: an absent `vault_id` is the personal vault, and an absent
 * `folder_id` is that vault's root, reported as null rather than omitted so
 * "at the root" is distinguishable from "not reported".
 *
 * Snake_case matches the object records and `object_move`'s own arguments.
 * `PluginFolder` is camelCase and already carries its placement — folders are
 * not projected through here.
 */
export function placement(o: Record<string, unknown>): { vault_id: string; folder_id: string | null } {
  return {
    vault_id: (o.vault_id as string | undefined) ?? "personal",
    folder_id: (o.folder_id as string | undefined) ?? null,
  };
}
