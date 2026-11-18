import type { NavItem } from "@/stores/uiStore";
import type { VaultClipboard, VaultClipboardKind } from "@/stores/vaultClipboardStore";
import type { PluginObjectMoveInput, PluginObjectMoveOutcome } from "../api";
import {
  pasteFromClipboard,
  runPaste,
  type CascadeEntry,
  type ClipboardAdapter,
} from "@/services/vaultClipboard";
import type { VaultObjectPorts } from "@/services/vaultObjectWrites";
import {
  createPasteState,
  headlessVaultObjectsAdapter,
  type PasteState,
  type VaultObjectTab,
} from "@/services/clipboard/vaultObjectsAdapter";
import { vaultOf } from "./vaultOf";

export type ObjectTab = "hosts" | "keychain" | "port_forwarding" | "snippets";

export type MoveInput = PluginObjectMoveInput;
export type MoveOutcome = PluginObjectMoveOutcome;

/**
 * Called once with everything the request must be authorized for, after the
 * stores are hydrated and before anything else runs. Throwing refuses the call.
 *
 * Passed in rather than run by the caller beforehand because the permissions can
 * only be computed from hydrated stores, and hydration is expensive enough — a
 * full team-vault sync among it — that doing it on both sides of the gate meant
 * doing it twice per call.
 */
export type Authorize = (permissions: string[]) => void;

export interface ObjectsAPI {
  move(input: MoveInput, authorize: Authorize): Promise<MoveOutcome>;
  copy(input: MoveInput, authorize: Authorize): Promise<MoveOutcome>;
}

/**
 * Everything the four vault-object tabs are read and written through, headlessly.
 *
 * The reads are functions, not arrays: `hydrate` runs first and the lists must be
 * the post-hydration ones. The writes are the same store methods the pages call,
 * so the vault permission checks inside them still apply.
 */
export interface ObjectPorts extends VaultObjectPorts {
  /** Loads the lazily-hydrated stores. See `run` for why it is not optional. */
  hydrate(): Promise<void>;
  can(permission: string, vaultId: string, objectId?: string): boolean;
  isTeamVault(vaultId: string): boolean;
  vaults(): { id: string; name: string }[];
  accessibleVaultIds(): string[];
}

const NAV_ITEM: Record<ObjectTab, NavItem> = {
  hosts: "hosts",
  keychain: "keychain",
  port_forwarding: "port-forwarding",
  snippets: "snippets",
};

/** The tab a folder record's `object_type` belongs to. Snippet folders live in their own store. */
const TAB_OF_FOLDER_TYPE: Record<string, ObjectTab> = {
  connection: "hosts",
  keychain: "keychain",
  port_forwarding: "port_forwarding",
  snippet: "snippets",
};

// ─── Tab and kind resolution ──────────────────────────────────────────────

interface Located {
  tab: ObjectTab;
  kind: VaultClipboardKind | "folder";
}

function locate(ports: ObjectPorts, id: string): Located | null {
  if (ports.connections().some((c) => c.id === id)) return { tab: "hosts", kind: "connection" };
  if (ports.keys().some((k) => k.id === id)) return { tab: "keychain", kind: "key" };
  if (ports.identities().some((i) => i.id === id)) return { tab: "keychain", kind: "identity" };
  if (ports.rules().some((r) => r.id === id)) return { tab: "port_forwarding", kind: "port_forward" };
  if (ports.snippets().some((s) => s.id === id)) return { tab: "snippets", kind: "snippet" };
  const folder = ports.folders().find((f) => f.id === id);
  if (folder) {
    const tab = TAB_OF_FOLDER_TYPE[folder.object_type];
    if (tab) return { tab, kind: "folder" };
  }
  if (ports.snippetFolders().some((f) => f.id === id)) return { tab: "snippets", kind: "folder" };
  return null;
}

/**
 * The one tab the ids belong to.
 *
 * A paste is a single tab's operation — the clipboard carries the tab it was
 * filled on and `pasteFromClipboard` drops anything else — so a mixed set would
 * silently move only part of it. Refused instead, naming both tabs.
 *
 * The ids come back de-duplicated: a repeated id would otherwise be moved twice
 * — duplicated twice on a copy — and counted twice in the outcome.
 */
function resolveTab(
  ports: ObjectPorts,
  rawIds: string[],
): { tab: ObjectTab; located: Map<string, Located>; ids: string[] } {
  const ids = [...new Set(rawIds)];
  if (ids.length === 0) throw new Error("No object ids given");
  const located = new Map<string, Located>();
  const tabs = new Set<ObjectTab>();
  for (const id of ids) {
    const found = locate(ports, id);
    if (!found) throw new Error(`Object "${id}" not found`);
    located.set(id, found);
    tabs.add(found.tab);
  }
  if (tabs.size > 1) {
    throw new Error(
      `Ids span more than one tab (${[...tabs].join(", ")}); move or copy one tab's objects at a time`,
    );
  }
  return { tab: [...tabs][0], located, ids };
}

// ─── The headless adapter ─────────────────────────────────────────────────

/**
 * The same adapter the page builds, with no page: no confirmation (the
 * `allowCrossVault` flag is the authorization, decided before this runs) and no
 * selection to update. Building it runs no store method, which is what lets the
 * cross-vault refusal below read `planCascade` without mutating anything.
 */
function buildAdapter(ports: ObjectPorts, tab: ObjectTab, input: MoveInput, state: PasteState): ClipboardAdapter {
  return headlessVaultObjectsAdapter({
    tab: NAV_ITEM[tab] as VaultObjectTab,
    ports,
    can: ports.can,
    state,
    folderId: input.folderId,
    vaultId: input.vaultId,
    accessibleVaultIds: ports.accessibleVaultIds(),
    vaultOptions: ports.vaults(),
  });
}


// ─── Permissions ──────────────────────────────────────────────────────────

/** The plugin permission each kind's write needs — one per kind, nothing wider. */
const KIND_PERMISSION: Record<VaultClipboardKind | "folder", string> = {
  connection: "connections:write",
  port_forward: "port_forwarding:write",
  key: "keys:write",
  identity: "identities:write",
  snippet: "snippets:write",
  folder: "folders:write",
};

const ALL_OBJECT_PERMISSIONS = [...new Set(Object.values(KIND_PERMISSION))];

/** The kinds a tab's folder can hold — a folder travels with its contents. */
const TAB_CONTENT_KINDS: Record<ObjectTab, VaultClipboardKind[]> = {
  hosts: ["connection"],
  keychain: ["key", "identity"],
  port_forwarding: ["port_forward"],
  snippets: ["snippet"],
};

/**
 * Kinds a hosts paste writes beyond the objects it names on any cross-vault
 * call: the key and identity a host references, private material included.
 * Anything else a call carries is authorized from its own plan in `run`.
 */
const TAB_CASCADE_KINDS: Record<ObjectTab, VaultClipboardKind[]> = {
  hosts: ["key", "identity"],
  keychain: [],
  port_forwarding: [],
  snippets: [],
};

/**
 * What a call must be authorized for, from the kinds it names. An id that
 * resolves to nothing asks for everything — a wrong guess there would under-gate
 * the call.
 *
 * A folder asks for its tab's kinds too: moving one carries its contents into
 * the destination vault and copying one duplicates them, secrets included, so
 * `folders:write` alone would let a plugin relocate the keys it was never
 * granted. Taken from the tab rather than the subtree so an empty folder that
 * fills up between the gate and the paste cannot widen what was authorized.
 *
 * A hosts id also asks for the keychain's kinds on the same grounds. What else
 * the paste carries depends on the call, so `run` authorizes it from the plan.
 *
 * A destination vault adds nothing: a move or copy never creates or destroys a
 * vault, so demanding `vaults:write` — which also deletes them — for filing a
 * snippet one folder over would conflate two different capabilities.
 */
export function objectPermissionsFor(ports: ObjectPorts, input: MoveInput): string[] {
  const perms = new Set<string>();
  for (const id of input.ids) {
    const found = locate(ports, id);
    if (!found) {
      for (const p of ALL_OBJECT_PERMISSIONS) perms.add(p);
      continue;
    }
    perms.add(KIND_PERMISSION[found.kind]);
    if (found.kind === "folder") {
      for (const kind of TAB_CONTENT_KINDS[found.tab]) perms.add(KIND_PERMISSION[kind]);
    }
    for (const kind of TAB_CASCADE_KINDS[found.tab]) perms.add(KIND_PERMISSION[kind]);
  }
  return [...perms];
}

// ─── The namespace ────────────────────────────────────────────────────────

interface CrossVaultPlan {
  /** Objects that would change vault. */
  count: number;
  targetVaultId: string;
  targetVaultName: string;
  cascade: CascadeEntry[];
}

export function createObjectsAPI(ports: ObjectPorts): ObjectsAPI {
  const nameOf = (vaultId: string): string =>
    ports.vaults().find((v) => v.id === vaultId)?.name ?? vaultId;

  const run = async (
    mode: "cut" | "copy",
    input: MoveInput,
    authorize: Authorize,
  ): Promise<MoveOutcome> => {
    // Not optional: snippets, snippet folders, rules, keys and identities are
    // loaded by their own pages, and a headless read of an unhydrated store
    // reports an empty tab — which resolves every id to "not found" and, where
    // it does not, decides a paste has nothing to carry with it.
    //
    // Once per call, here: the permission set is derived from these same reads,
    // so the gate runs against the hydrated stores without hydrating again.
    await ports.hydrate();
    authorize(objectPermissionsFor(ports, input));

    const { tab, located, ids } = resolveTab(ports, input.ids);
    const tabFolders = tab === "snippets"
      ? ports.snippetFolders()
      : ports.folders().filter((f) => TAB_OF_FOLDER_TYPE[f.object_type] === tab);

    const destinationFolder = input.folderId === null
      ? null
      : tabFolders.find((f) => f.id === input.folderId);
    if (input.folderId !== null && !destinationFolder) {
      throw new Error(`Folder "${input.folderId}" not found on the ${tab} tab`);
    }
    if (destinationFolder && input.vaultId !== null && vaultOf(destinationFolder) !== input.vaultId) {
      throw new Error(
        `Folder "${destinationFolder.id}" is in vault "${vaultOf(destinationFolder)}", not "${input.vaultId}"`,
      );
    }

    const adapter = buildAdapter(ports, tab, input, createPasteState());

    // The adapter's own answer, not a second derivation: a folder with no vault
    // names no destination there either, and the two must not disagree.
    const destination = adapter.targetVaultId();
    if (destination !== null && ports.isTeamVault(destination)) {
      throw new Error(`Vault "${nameOf(destination)}" is a team vault and cannot be written from here`);
    }

    // A team vault is refused as the SOURCE too, not just the destination, as
    // every other write verb refuses one (api.connections.update/delete).
    // A move rewrites the team's record and withdraws its secrets — the object
    // and its credentials vanish for every teammate; a copy carries the team's
    // key material into a personal vault, where the destination authorizes
    // unconditionally and nothing checks the source.
    const fromTeam = ids.find((id) => ports.isTeamVault(adapter.vaultIdOf(id)));
    if (fromTeam) {
      throw new Error(
        `Object "${fromTeam}" is in team vault "${nameOf(adapter.vaultIdOf(fromTeam))}" and cannot be `
        + `${mode === "copy" ? "copied" : "moved"} from here`,
      );
    }

    const items: { id: string; kind: VaultClipboardKind }[] = [];
    const folderIds: string[] = [];
    for (const id of ids) {
      const { kind } = located.get(id)!;
      if (kind === "folder") folderIds.push(id);
      else items.push({ id, kind });
    }
    const clipboard: VaultClipboard = {
      tab: NAV_ITEM[tab],
      mode,
      items,
      folderIds,
      sourceVaultIds: [...new Set(ids.map((id) => adapter.vaultIdOf(id)))],
    };

    // A folder cannot be filed under itself or under one of its own descendants.
    // The paste skips such a folder, which would otherwise report as a no-op.
    if (mode === "cut") {
      const impossible = folderIds.find((id) => !adapter.canMoveFolder(id, adapter.targetFolderId()));
      if (impossible) {
        throw new Error(`Refused: folder "${impossible}" cannot be filed under itself or its own subtree`);
      }
    }

    // Before any store method runs, and without starting the paste: a caller that
    // did not ask to cross vaults gets the plan back and can re-issue informed.
    if (destination !== null && !input.allowCrossVault) {
      const crossing = ids.filter((id) => adapter.vaultIdOf(id) !== destination);
      if (crossing.length > 0) {
        const plan: CrossVaultPlan = {
          count: crossing.length,
          targetVaultId: destination,
          targetVaultName: nameOf(destination),
          cascade: adapter.planCascade?.(items, folderIds, destination, mode) ?? [],
        };
        throw new Error(
          `Refused: this would move ${crossing.length} object(s) into another vault. `
          + `Pass allowCrossVault to authorize it. ${JSON.stringify({ plan })}`,
        );
      }
    }

    // The cascade may carry referenced objects too, and a team one is refused like a team root.
    const teamTraveller = destination === null
      ? undefined
      : adapter.planCascade?.(items, folderIds, destination, mode).find((e) => ports.isTeamVault(e.sourceVaultId));
    if (teamTraveller) {
      throw new Error(
        `Refused: ${teamTraveller.type} "${teamTraveller.id}" referenced by the selection is in team vault `
        + `"${nameOf(teamTraveller.sourceVaultId)}" and cannot be carried from here`,
      );
    }

    // Through the shared serializer, like the pages: an overlapping paste holds
    // the `withoutHistory` window open and the other one's undo entry is lost.
    // Planned and authorized inside the queue with no await before the paste, which plans the same cascade.
    const result = await runPaste(() => {
      const carried = destination === null ? [] : adapter.planCascade?.(items, folderIds, destination, mode) ?? [];
      authorize([...new Set(carried.map((entry) => KIND_PERMISSION[entry.type]))]);
      return pasteFromClipboard(clipboard, adapter);
    });
    // Every non-mutating outcome is a refusal here. Reported as a success it
    // reads as "moved 0, nothing wrong", which is how a silently dropped paste
    // looks to a caller with no toast to see.
    if (result.blocked?.length) {
      throw new Error(`Refused: missing ${result.blocked.join(", ")}`);
    }
    if (result.dangling?.length) {
      throw new Error(
        `Refused: would leave ${result.dangling.join(", ")} referenced from outside the destination vault`,
      );
    }
    // Only when nothing landed: a partial paste has already written, and pushed
    // its undo entry, so throwing would lose the counts the caller has to act on.
    if (result.crossVaultAtRoot && result.moved === 0 && result.created === 0) {
      throw new Error("Refused: the destination root does not show the source vault");
    }
    return {
      moved: result.moved,
      created: result.created,
      skipped: result.skipped,
      // `destination` is the adapter's resolved target, the same value the
      // cross-vault refusal above is decided on, so the outcome cannot name a
      // vault the paste did not actually write to.
      vault_id: destination,
      folder_id: adapter.targetFolderId(),
    };
  };

  return {
    move: (input, authorize) => run("cut", input, authorize),
    copy: (input, authorize) => run("copy", input, authorize),
  };
}
