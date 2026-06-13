import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import MobileFilterBar from "../MobileFilterBar";
import KeychainItemActionsSheet from "../sheets/KeychainItemActionsSheet";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { useAllKeys } from "@/hooks/useAllKeys";
import { useAllIdentities } from "@/hooks/useAllIdentities";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import type { SshKey, Identity } from "@/types";

type Sheet =
  | { kind: "key"; item: SshKey }
  | { kind: "identity"; item: Identity }
  | null;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {tags.slice(0, 3).map((t) => (
        <span key={t} className="px-1.5 py-0.5 rounded text-[10px] text-(--t-text-dim)" style={{ background: "var(--t-bg-card)" }}>
          {t}
        </span>
      ))}
    </span>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-4 pb-1">
      <span className="text-[11px] font-semibold tracking-wide text-(--t-text-dim)">{label}</span>
      <span className="px-1.5 py-0.5 rounded-full text-[10px] text-(--t-text-dim)" style={{ background: "var(--t-bg-card)" }}>{count}</span>
    </div>
  );
}

export default function MobileKeychainScreen({ folderId }: { folderId?: string }) {
  const keys = useAllKeys();
  const identities = useAllIdentities();
  const folders = useAllFolders();
  const push = useMobileNavStore((s) => s.push);

  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);

  const scope = folderId ?? undefined;
  const q = search.trim().toLowerCase();

  const subFolders = useMemo(
    () => folders
      .filter((f) => f.object_type === "keychain" && (f.parent_folder_id ?? undefined) === scope)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, scope],
  );

  const scopedKeys = useMemo(
    () => keys
      .filter((k) => (k.folder_id ?? undefined) === scope)
      .filter((k) => !q
        || (k.name ?? "").toLowerCase().includes(q)
        || (k.key_type ?? "").toLowerCase().includes(q)
        || k.tags.some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [keys, scope, q],
  );

  const scopedIdentities = useMemo(
    () => identities
      .filter((i) => (i.folder_id ?? undefined) === scope)
      .filter((i) => !q
        || (i.name ?? "").toLowerCase().includes(q)
        || i.username.toLowerCase().includes(q)
        || i.tags.some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => (a.name ?? a.username).localeCompare(b.name ?? b.username)),
    [identities, scope, q],
  );

  const isEmpty = subFolders.length === 0 && scopedKeys.length === 0 && scopedIdentities.length === 0;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader title="Keychain" />
      <MobileFilterBar value={search} onChange={setSearch} placeholder="Filter keychain…" />

      <div className="flex-1 overflow-y-auto pb-4">
        {subFolders.length > 0 && (
          <div className="px-2 pt-1">
            {subFolders.map((f) => (
              <button
                key={f.id}
                data-keychain-folder
                className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-left active:bg-(--t-bg-card)"
                onClick={() => push({ kind: "more-page", page: "keychain", folderId: f.id })}
              >
                <AvatarTile icon="lucide:folder" className="w-9 h-9 rounded-lg" iconSize={18} />
                <span className="flex-1 min-w-0 text-sm font-medium text-(--t-text-primary) truncate">{f.name}</span>
                <Icon icon="lucide:chevron-right" width={18} className="text-(--t-text-dim) shrink-0" />
              </button>
            ))}
          </div>
        )}

        {scopedKeys.length > 0 && (
          <div className="px-2">
            <SectionHeader label="SSH KEYS" count={scopedKeys.length} />
            {scopedKeys.map((k) => (
              <button
                key={k.id}
                data-keychain-key
                className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-left active:bg-(--t-bg-card)"
                onClick={() => setSheet({ kind: "key", item: k })}
              >
                <AvatarTile icon="lucide:key-round" className="w-9 h-9 rounded-lg" iconSize={18} />
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{k.name ?? "Unnamed key"}</span>
                  <span className="text-[11px] text-(--t-text-dim) truncate">
                    {k.key_type ? `${k.key_type} · ` : ""}added {shortDate(k.created_at)}
                  </span>
                  <TagChips tags={k.tags} />
                </span>
              </button>
            ))}
          </div>
        )}

        {scopedIdentities.length > 0 && (
          <div className="px-2">
            <SectionHeader label="IDENTITIES" count={scopedIdentities.length} />
            {scopedIdentities.map((i) => (
              <button
                key={i.id}
                data-keychain-identity
                className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-left active:bg-(--t-bg-card)"
                onClick={() => setSheet({ kind: "identity", item: i })}
              >
                <AvatarTile icon="lucide:user" className="w-9 h-9 rounded-lg" iconSize={18} />
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{i.name ?? i.username}</span>
                  {i.name && <span className="text-[11px] text-(--t-text-dim) truncate">{i.username}</span>}
                  <TagChips tags={i.tags} />
                </span>
              </button>
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center justify-center text-center px-8 pt-20 gap-1">
            <Icon icon="lucide:key-round" width={28} className="text-(--t-text-dim)" />
            <span className="text-sm text-(--t-text-dim)">{q ? "Nothing matches your search" : "Keychain is empty"}</span>
          </div>
        )}
      </div>

      {sheet && (sheet.kind === "key"
        ? <KeychainItemActionsSheet kind="key" item={sheet.item} onClose={() => setSheet(null)} />
        : <KeychainItemActionsSheet kind="identity" item={sheet.item} onClose={() => setSheet(null)} />)}
    </div>
  );
}
