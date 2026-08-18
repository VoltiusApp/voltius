import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { ConfirmIntent } from "@/services/deepLinkUrl";
import { joinTeamSessionAndOpenTab } from "@/services/teamSessionJoin";
import { searchUsers } from "@/services/teamService";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import type { InviteTarget } from "@/services/teamSharing";

export type ConfirmRoute = ConfirmIntent["route"];
type IntentOf<K extends ConfirmRoute> = Extract<ConfirmIntent, { route: K }>;

export interface ConfirmDetails {
  title: string;
  body: string;
  /** Dim line under the body: what the link cannot tell us, or why accept is off. */
  note?: string;
}

export interface ConfirmSpec<K extends ConfirmRoute, L> {
  icon: string;
  acceptLabelKey: string;
  errorKey: string;
  /**
   * Resolves what the link names. Omitted where the intent already says
   * everything, so such a sheet paints complete in its first frame rather than
   * flashing a spinner over copy it already has.
   */
  load?: (intent: IntentOf<K>) => Promise<L>;
  details: (intent: IntentOf<K>, loaded: L | null, t: TFunction) => ConfirmDetails;
  extra?: (loaded: L | null, t: TFunction) => ReactNode;
  /** Guards accept on what `load` found. Absent means "acceptable once loaded". */
  canAccept?: (loaded: L | null) => boolean;
  accept: (intent: IntentOf<K>, loaded: L | null, t: TFunction) => Promise<void>;
}

export interface InviteLoad {
  target: InviteTarget | null;
  /** The local session this device can invite into, or null when there is none. */
  localSessionId: string | null;
}

/** What each route's `load` produces. `void` for a route with nothing to fetch. */
export interface ConfirmLoad {
  join: void;
  invite: InviteLoad;
}

/**
 * The local session this device is currently sharing *and* still holds a per-user
 * session key for. An `invite_link` session keeps no such key, so inviting into
 * one would always throw `cannotInviteWithoutSessionKey`.
 */
function shareableSessionId(): string | null {
  const id = useSessionStore.getState().activeSessionId;
  if (!id) return null;
  return useTeamSessionStore.getState().connections[id]?.sessionKeyBytes ? id : null;
}

export const CONFIRM_SPECS: { [K in ConfirmRoute]: ConfirmSpec<K, ConfirmLoad[K]> } = {
  join: {
    icon: "lucide:users",
    acceptLabelKey: "terminal.share.deepLinkJoinAction",
    errorKey: "terminal.share.deepLinkJoinFailed",
    details: (_intent, _loaded, t) => ({
      title: t("terminal.share.deepLinkJoinTitle"),
      body: t("terminal.share.deepLinkJoinBody"),
      // The link carries no host name, so naming one would mean inventing it.
      note: t("terminal.share.deepLinkJoinUnknownHost"),
    }),
    accept: async (intent, _loaded, t) => {
      await joinTeamSessionAndOpenTab({
        sessionId: intent.sessionId,
        connectionName: t("hosts.teamSessions.sharedTerminalFallback"),
        inviteToken: intent.token,
      });
    },
  },
  invite: {
    icon: "lucide:user-plus",
    acceptLabelKey: "terminal.share.deepLinkInviteAction",
    errorKey: "terminal.share.deepLinkInviteFailed",
    load: async ({ handle }) => {
      const results = await searchUsers(handle);
      // Exact match only. A fuzzy hit would let `@kev` land on `@kevin-p`, which
      // is the impersonation shape the unified invite design set out to close.
      const match = results.find((user) => user.handle.toLowerCase() === handle);
      return {
        target: match ? { user_id: match.user_id, handle: match.handle } : null,
        localSessionId: shareableSessionId(),
      };
    },
    details: (intent, loaded, t) => ({
      title: t("terminal.share.deepLinkInviteTitle", { handle: intent.handle }),
      body: t("terminal.share.deepLinkInviteBody", { handle: intent.handle }),
      note: !loaded
        ? undefined
        : !loaded.target
          ? t("terminal.share.deepLinkInviteUnknownUser", { handle: intent.handle })
          : !loaded.localSessionId
            ? t("terminal.share.deepLinkInviteNoActiveSession")
            : undefined,
    }),
    canAccept: (loaded) => !!loaded?.target && !!loaded.localSessionId,
    accept: async (_intent, loaded) => {
      if (!loaded?.target || !loaded.localSessionId) return;
      await useTeamSessionStore.getState().inviteToActiveSession(loaded.localSessionId, loaded.target);
    },
  },
};
