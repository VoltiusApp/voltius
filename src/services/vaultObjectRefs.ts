import type { Connection, Identity, PortForwardingRule, Snippet, SshKey } from "@/types";
import type { VaultClipboardKind } from "@/stores/vaultClipboardStore";

export interface VaultObjectCatalogue {
  connections: Connection[];
  identities: Identity[];
  keys: SshKey[];
  snippets: Snippet[];
  rules: PortForwardingRule[];
}

export type VaultObject = Connection | Identity | SshKey | Snippet | PortForwardingRule;

export interface ObjectRef {
  kind: VaultClipboardKind;
  id: string;
}

export interface CascadeTraveller extends ObjectRef {
  label: string;
  sourceVaultId: string;
  action: "move" | "copy";
  /** Reading order: what the pasted objects point at directly comes before what that pulls in. */
  discovered: number;
}

/** Original id to the copy a paste made of it, keyed by `refKey`. */
export type RemapTable = Map<string, string>;

export const refKey = (ref: ObjectRef): string => `${ref.kind}:${ref.id}`;

export const vaultOfObject = (o: { vault_id?: string | null }): string => o.vault_id ?? "personal";

export function objectsOfKind(cat: VaultObjectCatalogue, kind: VaultClipboardKind): VaultObject[] {
  switch (kind) {
    case "connection": return cat.connections;
    case "identity": return cat.identities;
    case "key": return cat.keys;
    case "snippet": return cat.snippets;
    case "port_forward": return cat.rules;
  }
}

export const findObject = (cat: VaultObjectCatalogue, ref: ObjectRef): VaultObject | undefined =>
  objectsOfKind(cat, ref.kind).find((o) => o.id === ref.id);

export function objectLabel(kind: VaultClipboardKind, o: VaultObject): string {
  switch (kind) {
    case "connection": return (o as Connection).name || (o as Connection).host;
    case "identity": return (o as Identity).name || (o as Identity).username;
    // default name kept in English until all creation sites are localized together (see i18n issue #14)
    case "key": return (o as SshKey).name ?? "Unnamed key";
    default: return (o as Snippet | PortForwardingRule).name;
  }
}

const snippetCallees = (s: Snippet): string[] =>
  s.steps.flatMap((step) => (step.kind === "snippet" ? [step.snippet_id] : []));

/** Every object `o` points at, whether or not it still exists. */
function rawRefsOf(cat: VaultObjectCatalogue, kind: VaultClipboardKind, o: VaultObject): ObjectRef[] {
  const refs: ObjectRef[] = [];
  const add = (k: VaultClipboardKind, id: string | undefined | null) => { if (id) refs.push({ kind: k, id }); };
  switch (kind) {
    case "connection": {
      const c = o as Connection;
      add("identity", c.identity_id);
      add("key", c.key_id);
      for (const jh of c.jump_hosts ?? []) {
        // A jump whose host is gone resolves from its snapshot, which may name an identity.
        if (findObject(cat, { kind: "connection", id: jh.connection_id })) add("connection", jh.connection_id);
        else add("identity", jh.identity_id);
      }
      add("snippet", c.pre_snippet_id);
      add("snippet", c.post_snippet_id);
      break;
    }
    case "identity": add("key", (o as Identity).key_id); break;
    case "snippet": for (const id of snippetCallees(o as Snippet)) add("snippet", id); break;
    case "port_forward": for (const id of (o as PortForwardingRule).connection_ids) add("connection", id); break;
    case "key": break;
  }
  return refs;
}

export const refsOf = (cat: VaultObjectCatalogue, kind: VaultClipboardKind, o: VaultObject): ObjectRef[] =>
  rawRefsOf(cat, kind, o).filter((r) => !!findObject(cat, r));

/** The link fields of `o` with every reference rewritten through `remap`. */
export function relinkedFields(
  kind: VaultClipboardKind,
  o: VaultObject,
  remap: RemapTable,
): Record<string, unknown> {
  const to = (k: VaultClipboardKind, id: string) => remap.get(refKey({ kind: k, id })) ?? id;
  const opt = (k: VaultClipboardKind, id: string | undefined) => (id ? to(k, id) : id);
  switch (kind) {
    case "connection": {
      const c = o as Connection;
      return {
        identity_id: opt("identity", c.identity_id),
        key_id: opt("key", c.key_id),
        jump_hosts: c.jump_hosts?.map((jh) => ({
          ...jh,
          connection_id: to("connection", jh.connection_id),
          identity_id: opt("identity", jh.identity_id),
        })),
        pre_snippet_id: opt("snippet", c.pre_snippet_id),
        post_snippet_id: opt("snippet", c.post_snippet_id),
      };
    }
    case "identity": return { key_id: opt("key", (o as Identity).key_id) };
    case "snippet":
      return {
        steps: (o as Snippet).steps.map((step) =>
          step.kind === "snippet" ? { ...step, snippet_id: to("snippet", step.snippet_id) } : step),
      };
    case "port_forward":
      return { connection_ids: (o as PortForwardingRule).connection_ids.map((id) => to("connection", id)) };
    case "key": return {};
  }
}

export function linksDiffer(kind: VaultClipboardKind, o: VaultObject, remap: RemapTable): boolean {
  const next = relinkedFields(kind, o, remap);
  return JSON.stringify(next) !== JSON.stringify(relinkedFields(kind, o, new Map()));
}

/** What `roots` reach outside `destination`, dependencies first. A cut moves one only when nothing
 *  left outside `destination` still points at it; anything else is copied. */
export function planReferenceCascade(
  cat: VaultObjectCatalogue,
  roots: ObjectRef[],
  destination: string,
  mode: "copy" | "cut",
): CascadeTraveller[] {
  const rootKeys = new Set(roots.map(refKey));
  const seen = new Map<string, number>();
  const order: { ref: ObjectRef; obj: VaultObject }[] = [];

  const visit = (ref: ObjectRef, obj: VaultObject) => {
    for (const dep of refsOf(cat, ref.kind, obj)) {
      const k = refKey(dep);
      if (rootKeys.has(k) || seen.has(k)) continue;
      const target = findObject(cat, dep)!;
      if (vaultOfObject(target) === destination) continue;
      seen.set(k, seen.size);
      visit(dep, target);
      order.push({ ref: dep, obj: target });
    }
  };
  for (const root of roots) {
    const obj = findObject(cat, root);
    if (obj && vaultOfObject(obj) !== destination) visit(root, obj);
  }

  const moving = new Set(mode === "cut" ? order.map((t) => refKey(t.ref)) : []);
  if (moving.size > 0) {
    const referrers = new Map<string, { key: string; vault: string }[]>();
    for (const kind of ["connection", "identity", "key", "snippet", "port_forward"] as const) {
      for (const o of objectsOfKind(cat, kind)) {
        const from = { key: refKey({ kind, id: o.id }), vault: vaultOfObject(o) };
        for (const dep of refsOf(cat, kind, o)) {
          const list = referrers.get(refKey(dep)) ?? [];
          list.push(from);
          referrers.set(refKey(dep), list);
        }
      }
    }
    const staysOutside = (r: { key: string; vault: string }) =>
      !rootKeys.has(r.key) && !moving.has(r.key) && r.vault !== destination;
    let changed = true;
    while (changed) {
      changed = false;
      for (const k of moving) {
        if (referrers.get(k)?.some(staysOutside)) {
          moving.delete(k);
          changed = true;
        }
      }
    }
  }

  return order.map(({ ref, obj }) => ({
    ...ref,
    label: objectLabel(ref.kind, obj),
    sourceVaultId: vaultOfObject(obj),
    action: moving.has(refKey(ref)) ? "move" : "copy",
    discovered: seen.get(refKey(ref))!,
  }));
}
