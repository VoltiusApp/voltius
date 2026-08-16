import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import { joinTeamSessionAndOpenTab } from "@/services/teamSessionJoin";

export function DeepLinkJoinModal() {
  const { t } = useTranslation();
  const prompt = useDeepLinkStore((s) => s.prompt);
  const dismissPrompt = useDeepLinkStore((s) => s.dismissPrompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stays mounted between prompts, so a prior failure's error would leak in.
  useEffect(() => {
    setError(null);
  }, [prompt]);

  if (!prompt) return null;

  const handleJoin = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await joinTeamSessionAndOpenTab({
        sessionId: prompt.sessionId,
        connectionName: t("hosts.teamSessions.sharedTerminalFallback"),
        inviteToken: prompt.token,
      });
      dismissPrompt();
    } catch {
      setError(t("terminal.share.deepLinkJoinFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={dismissPrompt}>
      <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem] max-w-[26.667rem]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)" }}
          >
            <Icon icon="lucide:users" width={16} className="text-(--t-accent)" />
          </div>
          <h2 className="text-sm font-semibold text-(--t-text-bright)">
            {t("terminal.share.deepLinkJoinTitle")}
          </h2>
        </div>
        <p className="text-sm text-(--t-text-secondary)">
          {t("terminal.share.deepLinkJoinBody")}
        </p>
        {/* The link carries no host name, so naming one would mean inventing it. */}
        <p className="text-xs text-(--t-text-dim)">
          {t("terminal.share.deepLinkJoinUnknownHost")}
        </p>
        {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={dismissPrompt}
            className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
          >
            {t("common.action.cancel")}
          </button>
          <button
            onClick={() => void handleJoin()}
            disabled={loading}
            className="btn btn-primary px-4 py-2 rounded-lg text-sm font-medium"
          >
            {t("terminal.share.deepLinkJoinAction")}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
