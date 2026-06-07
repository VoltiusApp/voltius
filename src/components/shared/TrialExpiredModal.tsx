import { useState, useEffect } from "react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { openPortal } from "@/utils/billing";

const STORAGE_KEY = "voltius_trial_expired_shown";

export function TrialExpiredModal() {
  const { tier, trialEndsAt, trialUsed } = useSubscriptionStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trialUsed || !trialEndsAt) return;
    if (tier !== "free") return;
    if (trialEndsAt > new Date()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(true);
  }, [tier, trialEndsAt, trialUsed]);

  if (!visible) return null;

  function handleUpgrade() {
    openPortal();
    setVisible(false);
  }

  return (
    <Modal onClose={() => setVisible(false)}>
      <ModalCard className="flex flex-col gap-4 animate-fadeIn p-8" style={{ width: "min(28rem, 92vw)" }}>
        <div>
          <p className="text-base font-semibold text-(--t-text-primary) mb-1">
            Your Pro trial has ended
          </p>
          <p className="text-sm text-(--t-text-muted) leading-relaxed">
            You&apos;ve had 14 days to try Pro — hope it was useful. Upgrade to keep
            real-time sync and cloud features.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleUpgrade}
            className="w-full py-2.5 rounded-lg text-sm font-semibold bg-(--t-accent) text-white hover:opacity-90 transition-opacity"
          >
            Upgrade to Pro
          </button>
          <button
            onClick={() => setVisible(false)}
            className="w-full py-2.5 rounded-lg text-sm text-(--t-text-muted) hover:text-(--t-text-primary) transition-colors"
          >
            Maybe later
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
