import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BusinessLapseNotice, BusinessLockLine } from "@/components/shared/BusinessLockBanner";
import { FormSection } from "@/components/shared/Panel";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { PickerOption, PickerSearch } from "@/components/shared/pickerParts";
import { PermissionOverrideRow } from "@/components/members/panels/PermissionOverrideRow";
import { permissionLabel, roleLabel } from "@/components/members/roleChips";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { useRuleSet } from "@/hooks/useRuleSet";
import { saveObjectRules, syncWithFolder, type RuleEdit } from "@/services/ruleSetEditing";
import { isSynced, setOfParent } from "@/services/ruleSetPointers";
import {
  OBJECT_RULE_ROWS, PERM_BITS, applyOverrideState, overrideStateOf, resolveObjectPermissions,
  type OverrideState, type Permission, type RuleEntry,
} from "@/services/permissions";
import type { TeamObjectType } from "@/services/teamObjects";
import { resolveTeamIdFromCollections } from "@/services/resolveTeamId";
import type { TeamRole } from "@/services/teamService";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";

type Subject = { type: "everyone" } | { type: "role"; id: string } | { type: "member"; id: string };

const subjectKey = (s: Subject) => (s.type === "everyone" ? "everyone" : `${s.type}:${s.id}`);
const subjectIdOf = (s: Subject) => (s.type === "everyone" ? null : s.id);
const entryFor = (entries: RuleEntry[], s: Subject) =>
  entries.find((e) => e.subject_type === s.type && (e.subject_id ?? null) === subjectIdOf(s));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withEntry(entries: RuleEntry[], s: Subject, allow: number, deny: number): RuleEntry[] {
  const rest = entries.filter((e) => e !== entryFor(entries, s));
  return allow === 0 && deny === 0 ? rest : [...rest, { subject_type: s.type, subject_id: subjectIdOf(s), allow, deny }];
}

function listedSubjects(entries: RuleEntry[], roles: TeamRole[], added: Subject[]): Subject[] {
  const all: Subject[] = [
    { type: "everyone" },
    ...roles.filter((r) => entries.some((e) => e.subject_type === "role" && e.subject_id === r.id)).map((r) => ({ type: "role" as const, id: r.id })),
    ...entries.filter((e) => e.subject_type === "member").map((e) => ({ type: "member" as const, id: e.subject_id! })),
    ...added,
  ];
  return all.filter((s, i) => all.findIndex((o) => subjectKey(o) === subjectKey(s)) === i);
}

function SubjectChips({ listed, candidates, selected, nameOf, onSelect, onAdd, disabled }: {
  listed: Subject[];
  candidates: Subject[];
  selected: Subject;
  nameOf: (s: Subject) => string;
  onSelect: (s: Subject) => void;
  onAdd: (s: Subject) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const addRef = useRef<HTMLButtonElement>(null);
  const matches = candidates.filter((s) => nameOf(s).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex flex-wrap gap-1.5">
      {listed.map((s) => (
        <button
          key={subjectKey(s)}
          type="button"
          onClick={() => onSelect(s)}
          className="px-2 py-0.5 rounded-md text-xs bg-(--t-bg-base) border border-(--t-border-hover) text-(--t-text-primary)"
          style={subjectKey(s) === subjectKey(selected) ? { background: "var(--t-bg-elevated)" } : undefined}
        >
          {nameOf(s)}
        </button>
      ))}
      {!disabled && (
        <>
          <button ref={addRef} type="button" onClick={() => setPicking(true)} className="px-2 py-0.5 rounded-md text-xs text-(--t-accent)">
            {t("shared.permissions.section.addSubject")}
          </button>
          <PickerSurface open={picking} onClose={() => setPicking(false)} anchorRef={addRef} width="content" minWidth="14rem" align="right">
            <div className="sticky top-0 bg-(--t-bg-card) p-1.5">
              <PickerSearch value={query} onChange={setQuery} placeholder={t("shared.permissions.section.searchSubjects")} />
            </div>
            {matches.length === 0
              ? <p className="px-3 py-2 text-xs text-(--t-text-dim)">{t("shared.permissions.section.noSubjectsLeft")}</p>
              : matches.map((s) => (
                <PickerOption
                  key={subjectKey(s)}
                  label={nameOf(s)}
                  active={false}
                  onClick={() => { onAdd(s); setPicking(false); setQuery(""); }}
                />
              ))}
          </PickerSurface>
        </>
      )}
    </div>
  );
}

interface PermissionsSectionProps {
  objectId: string;
  vaultId?: string;
  type: TeamObjectType;
}

export function PermissionsSection(props: PermissionsSectionProps) {
  return <ObjectPermissions key={props.objectId} {...props} />;
}

function ObjectPermissions({ objectId, vaultId, type }: PermissionsSectionProps) {
  const { t } = useTranslation();
  const teams = useTeamStore((s) => s.teams);
  const teamId = useVaultStore((s) => resolveTeamIdFromCollections(vaultId, teams, s.vaults));
  const entries = useTeamObjectAccessStore((s) => (teamId ? s.byTeam[teamId] : undefined));
  const supported = useTeamObjectAccessStore((s) => (teamId ? s.supportedByTeam[teamId] ?? false : false));
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  const teamFolders = useFolderStore((s) => s.teamFolders);
  const teamSnippetFolders = useSnippetFolderStore((s) => s.teamSnippetFolders);
  const access = entries?.[objectId];
  const ruleSet = useRuleSet(teamId ?? "", access?.ruleSetId ?? null);
  const { locked } = useBusinessLock(teamId);
  const [draft, setDraft] = useState<RuleEntry[]>(ruleSet.entries);
  const [loaded, setLoaded] = useState(ruleSet.entries);
  const [selected, setSelected] = useState<Subject>({ type: "everyone" });
  const [added, setAdded] = useState<Subject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const chain = useRef(Promise.resolve());
  const lastSaved = useRef(ruleSet.entries);
  const pending = useRef(0);
  const generation = useRef(0);
  // Reset during render: an effect would clobber a click made right after load.
  // A reload that lands while saves are queued is skipped; draining the queue reloads.
  if (loaded !== ruleSet.entries) {
    setLoaded(ruleSet.entries);
    if (pending.current === 0) {
      lastSaved.current = ruleSet.entries;
      setDraft(ruleSet.entries);
    }
  }

  if (!teamId || !entries || !supported || !access || access.deleted) return null;
  if ((access.myPermissions & PERM_BITS.MANAGE_ROLES) === 0) return null;

  const roles = rolesByTeam[teamId] ?? [];
  const members = membersByTeam[teamId] ?? [];
  const parentName = [...(teamFolders[teamId] ?? []), ...(teamSnippetFolders[teamId] ?? [])]
    .find((f) => f.id === access.parentId)?.name;
  const synced = isSynced(entries, objectId);
  const parentSet = setOfParent(entries, access.parentId);
  const target = { teamId, objectId, type };
  const isCredential = type === "key" || type === "identity";
  const listed = listedSubjects(draft, roles, added);
  const nameOf = (s: Subject) =>
    s.type === "everyone" ? t("shared.permissions.everyone")
      : s.type === "role" ? roleLabel(t, roles.find((r) => r.id === s.id)?.name ?? "?")
      : `@${members.find((m) => m.user_id === s.id)?.handle ?? "?"}`;
  const candidates: Subject[] = [
    ...roles.map((r) => ({ type: "role" as const, id: r.id })),
    ...members.map((m) => ({ type: "member" as const, id: m.user_id })),
  ].filter((s) => !listed.some((l) => subjectKey(l) === subjectKey(s)));

  const rolesGranting = (bit: number, roleIds?: string[]) =>
    roles.filter((r) => (!locked || r.is_builtin) && (!roleIds || roleIds.includes(r.id)) && (r.permissions & bit) !== 0).map((r) => roleLabel(t, r.name));
  const sourceOf = (from: string[]) =>
    from.length > 2 ? [t("shared.permissions.section.roleCount", { count: from.length })] : from;

  const preview = (permission: Permission): { from: string[]; grants: boolean } => {
    const bit = PERM_BITS[permission];
    if (selected.type === "member") {
      const member = members.find((m) => m.user_id === selected.id);
      const others = draft.filter((e) => !(e.subject_type === "member" && e.subject_id === selected.id));
      return {
        from: sourceOf(rolesGranting(bit, member?.role_ids ?? [])),
        grants: member ? (resolveObjectPermissions(member, roles, others, locked) & bit) !== 0 : false,
      };
    }
    const from = rolesGranting(bit, selected.type === "role" ? [selected.id] : undefined);
    return { from: sourceOf(from), grants: from.length > 0 };
  };

  const save = (edit: RuleEdit) => {
    const gen = generation.current;
    setDraft(edit);
    setError(null);
    pending.current += 1;
    chain.current = chain.current.then(async () => {
      try {
        if (gen !== generation.current) return;
        const saved = await saveObjectRules(target, edit);
        if (saved) lastSaved.current = saved;
      } catch (e) {
        generation.current += 1;
        setDraft(lastSaved.current);
        setError(errorText(e));
      } finally {
        pending.current -= 1;
        if (pending.current === 0) ruleSet.reload();
      }
    });
  };

  const change = (permission: Permission, next: OverrideState) => {
    save((entries) => {
      const current = entryFor(entries, selected);
      const masks = applyOverrideState(permission, current?.allow ?? 0, current?.deny ?? 0, next);
      return withEntry(entries, selected, masks.allow, masks.deny);
    });
  };

  const title = type === "key" ? "shared.permissions.section.titleKey"
    : type === "identity" ? "shared.permissions.section.titleIdentity"
    : "shared.permissions.section.title";
  const banner = synced
    ? (parentName ? t("shared.permissions.section.syncedWith", { folder: parentName }) : t("shared.permissions.section.syncedTeam"))
    : t(parentSet === null ? "shared.permissions.section.ownPermissions" : "shared.permissions.section.notSynced");
  const current = entryFor(draft, selected);
  const connectState = overrideStateOf("CONNECT", current?.allow ?? 0, current?.deny ?? 0);
  const connectDenied = connectState === "deny" || (connectState === "inherit" && !preview("CONNECT").grants);
  const connectLabel = isCredential ? t("shared.permissions.section.use") : permissionLabel(t, "CONNECT");

  const hasRules = draft.length > 0 || ruleSet.status !== "ok";

  return (
    <FormSection label={t(title)}>
      {locked && !hasRules ? (
        <BusinessLockLine teamId={teamId} label={t("shared.businessLock.objectLine")} />
      ) : (
        <>
          <BusinessLapseNotice
            teamId={teamId}
            message={t("shared.businessLock.objectLapsed")}
            removeLabel={t("shared.businessLock.removeRules")}
            onRemove={!synced && draft.length > 0 ? async () => save(() => []) : undefined}
          />
          {isCredential && <p className="text-xs text-(--t-text-dim)">{t("shared.permissions.section.adminNote")}</p>}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-(--t-text-secondary)">{banner}</span>
            {!synced && (
              <button
                type="button"
                className="text-(--t-accent)"
                onClick={() => void syncWithFolder(target).catch((e) => setError(errorText(e)))}
              >
                {t(parentSet === null ? "shared.permissions.section.useTeams" : "shared.permissions.section.syncNow")}
              </button>
            )}
          </div>
          <SubjectChips
            listed={listed}
            candidates={candidates}
            selected={selected}
            nameOf={nameOf}
            onSelect={setSelected}
            onAdd={(s) => { setAdded((a) => [...a, s]); setSelected(s); }}
            disabled={locked}
          />
          <div>
            {OBJECT_RULE_ROWS[type].map((permission) => {
              const p = preview(permission);
              const needsConnect = connectDenied && (permission === "VIEW_SECRETS" || permission === "COPY_SECRETS");
              return (
                <PermissionOverrideRow
                  key={permission}
                  permission={permission}
                  label={isCredential && permission === "CONNECT" ? connectLabel : undefined}
                  note={needsConnect ? t("shared.permissions.section.requiresConnect", { connect: connectLabel }) : undefined}
                  state={overrideStateOf(permission, current?.allow ?? 0, current?.deny ?? 0)}
                  inheritedFrom={p.from}
                  inheritedGrants={p.grants && !needsConnect}
                  disabled={locked || ruleSet.status !== "ok" || needsConnect}
                  onChange={(next) => change(permission, next)}
                />
              );
            })}
          </div>
          {(error || ruleSet.status === "error") && (
            <p className="text-xs text-(--t-status-error)">{error ?? ruleSet.error ?? t("shared.permissions.section.loadFailed")}</p>
          )}
        </>
      )}
    </FormSection>
  );
}
