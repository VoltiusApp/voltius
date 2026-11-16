import { create } from "zustand";
import type { PreviewDraft, PreviewResponse } from "@/services/permissionPreview";
import type { PreviewSession } from "@/services/previewSnapshot";
import type { TeamObjectType } from "@/services/teamObjects";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";
import { bindPreviewGuard, withControlAuthority } from "@/services/previewGuard";
import { memberDraftStepCount, saveMemberDraft, type SaveFailure } from "@/services/viewAsSave";

export type { PreviewSession };

export type SidePanel = { kind: "access" } | { kind: "why"; type: TeamObjectType; objectId: string } | null;
export type SaveConfirm = "memberKeyLoss" | "roleKeyLoss";

interface PreviewState {
  session: PreviewSession | null;
  draft: PreviewDraft | null;
  result: PreviewResponse | null;
  resultDraft: PreviewDraft | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  side: SidePanel;
  saving: boolean;
  saveError: string | null;
  saveFailures: SaveFailure[];
  pendingConfirm: SaveConfirm | null;
  enter: (session: PreviewSession) => void;
  exit: () => void;
  setDraft: (draft: PreviewDraft | null) => void;
  refetch: () => Promise<void>;
  showWhy: (type: TeamObjectType, objectId: string) => void;
  showAccess: () => void;
  closeSide: () => void;
  requestSave: () => Promise<void>;
  confirmSave: () => Promise<void>;
  cancelSave: () => void;
  save: () => Promise<void>;
}

const IDLE = {
  session: null, draft: null, result: null, resultDraft: null, status: "idle", error: null, side: null,
  saving: false, saveError: null, saveFailures: [], pendingConfirm: null,
} as const satisfies Partial<PreviewState>;

const DRAFT_DEBOUNCE_MS = 250;

const ENDING_STATUSES = new Set([402, 403, 404]);

export function saveNeedsConfirm(result: PreviewResponse | null): SaveConfirm | null {
  if (!result) return null;
  if (result.current.holds_vault_key_gate && result.draft && !result.draft.holds_vault_key_gate) return "memberKeyLoss";
  if (result.affected?.lose_vault_key.length) return "roleKeyLoss";
  return null;
}

let unwatch: (() => void)[] = [];
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let sentSeq = 0;
let appliedSeq = 0;

function leftContent({ teamId, vaultId }: PreviewSession): boolean {
  const ids = useVaultStore.getState().selectedVaultIds;
  const ui = useUIStore.getState();
  return ids.length !== 1 || ids[0] !== vaultId
    || ui.homeView || ui.activeNav === "terminal" || ui.sftpPanelOpen || ui.settingsOpen
    || !useTeamStore.getState().teams.some((t) => t.id === teamId);
}

// Dynamic imports: usePermissions loads this store, and its consumers must not pull in i18n, sync or key rotation.
let syncModule: Promise<typeof import("@/services/sync")> | undefined;
const loadSync = () => (syncModule ??= import("@/services/sync"));

function watchSession(session: PreviewSession): (() => void)[] {
  const { teamId } = session;
  const store = () => usePreviewStore.getState();
  const exitIfLeft = () => { if (leftContent(session)) store().exit(); };
  const refetch = () => void store().refetch();
  const list = [
    useVaultStore.subscribe(exitIfLeft),
    useUIStore.subscribe(exitIfLeft),
    useTeamStore.subscribe((s, prev) => {
      exitIfLeft();
      if (store().session !== session) return;
      if (s.membersByTeam[teamId] !== prev.membersByTeam[teamId] || s.rolesByTeam[teamId] !== prev.rolesByTeam[teamId]) refetch();
    }),
  ];
  void loadSync().then(({ onTeamSseEvent }) => {
    if (unwatch === list) list.push(onTeamSseEvent((id) => { if (id === teamId) refetch(); }));
  });
  return list;
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  ...IDLE,

  enter: (session) => {
    get().exit();
    useVaultClipboardStore.getState().clear();
    useVaultStore.getState().selectVaultOnly(session.vaultId);
    useUIStore.getState().setSftpPanelOpen(false);
    set({ session, side: { kind: "access" } });
    unwatch = watchSession(session);
    if (leftContent(session)) get().exit();
    else void get().refetch();
  },

  exit: () => {
    if (!get().session) return;
    unwatch.forEach((stop) => stop());
    unwatch = [];
    clearTimeout(draftTimer);
    appliedSeq = sentSeq;
    set(IDLE);
  },

  setDraft: (draft) => {
    if (!get().session) return;
    set({ draft, saveError: null, saveFailures: [] });
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => void get().refetch(), DRAFT_DEBOUNCE_MS);
  },

  refetch: async () => {
    const { session, draft } = get();
    if (!session) return;
    const seq = ++sentSeq;
    set({ status: "loading" });
    const settle = () => {
      if (seq <= appliedSeq || get().session !== session) return false;
      appliedSeq = seq;
      return true;
    };
    try {
      const { previewPermissions } = await import("@/services/permissionPreview");
      const result = await previewPermissions(session.teamId, { subject: session.subject, ...(draft && { draft }) });
      if (settle()) set({ result, resultDraft: draft, status: seq === sentSeq ? "ready" : "loading", error: null });
    } catch (e) {
      if (!settle()) return;
      const status = (e as { status?: number }).status ?? 0;
      const message = e instanceof Error ? e.message : String(e);
      if (!ENDING_STATUSES.has(status)) {
        set({ status: "error", error: message });
        return;
      }
      get().exit();
      const { default: i18n } = await import("@/i18n");
      useNotificationStore.getState().addToast({
        source: APP_SOURCE, type: "toast", severity: "warning", duration: 5000,
        message: status === 402 ? i18n.t("members.viewAs.needsBusiness") : message,
      });
    }
  },

  showWhy: (type, objectId) => set({ side: { kind: "why", type, objectId } }),
  showAccess: () => set({ side: { kind: "access" } }),
  closeSide: () => set({ side: null }),

  requestSave: async () => {
    const confirm = saveNeedsConfirm(get().result);
    if (confirm) set({ pendingConfirm: confirm });
    else await get().save();
  },

  confirmSave: async () => {
    const teamId = get().session?.teamId;
    set({ pendingConfirm: null });
    await get().save();
    if (!teamId) return;
    const { checkAndRotateTeamKey } = await import("@/services/teamKeyRotation");
    await withControlAuthority(() => checkAndRotateTeamKey(teamId));
  },

  cancelSave: () => set({ pendingConfirm: null }),

  save: async () => {
    const { session, draft } = get();
    if (!session || !draft || !("role_ids" in draft) || session.subject.type !== "member") return;
    const { teamId, subject } = session;
    const member = useTeamStore.getState().membersByTeam[teamId]?.find((m) => m.user_id === subject.user_id);
    if (!member) return;
    set({ saving: true, saveError: null, saveFailures: [] });
    try {
      const total = memberDraftStepCount(teamId, member, draft);
      const { failed } = await saveMemberDraft(teamId, member, draft);
      await useTeamStore.getState().loadMembers(teamId).catch(() => {});
      if (get().session !== session) return;
      if (failed.length === 0) set({ draft: null });
      else {
        const { default: i18n } = await import("@/i18n");
        set({ saveFailures: failed, saveError: i18n.t("members.viewAs.saveFailed", { failed: failed.length, total }) });
      }
      await get().refetch();
    } catch (e) {
      set({ saveError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ saving: false });
    }
  },
}));

export const isPreviewing = (): boolean => usePreviewStore.getState().session !== null;

bindPreviewGuard({ active: isPreviewing, showWhy: (type, objectId) => usePreviewStore.getState().showWhy(type, objectId) });
