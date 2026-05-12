import { useState } from "react";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useTeamStore } from "@/stores/teamStore";
import { appFetch } from "@/services/http";

const SEAT_PRICE_MONTHLY = 15;

interface Props {
  teamId: string;
  pendingUser: { user_id: string; email: string } | null;
  pendingRole: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BuySeatsModal({ teamId, pendingUser, pendingRole, onClose, onSuccess }: Props) {
  const { usedSeats, totalSeats } = useSubscriptionStore();
  const addMemberById = useTeamStore((s) => s.addMemberById);
  const [additionalSeats, setAdditionalSeats] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const currentTotal = totalSeats ?? 3;
  const newTotal = currentTotal + additionalSeats;
  const monthlyCost = newTotal * SEAT_PRICE_MONTHLY;

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      const serverUrl = await invoke<string | null>("keychain_get", { key: "server_url" });
      const jwt = await invoke<string | null>("keychain_get", { key: "jwt" });
      if (!serverUrl || !jwt) throw new Error("Not connected to server");

      const res = await appFetch(`${serverUrl}/v1/billing/seats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ seats: newTotal, invoice_immediately: true }),
      });
      if (!res.ok) {
        if (res.status === 404) throw new Error("No active subscription found");
        throw new Error(`Failed to update seats: ${res.status}`);
      }

      // Reload subscription to get updated seat counts
      await useSubscriptionStore.getState().load();

      // Add the pending user if there is one
      if (pendingUser) {
        await addMemberById(teamId, pendingUser.user_id, pendingRole);
      }

      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-2xl p-6 space-y-5"
        style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--t-text-primary)" }}>
              No seats available
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-dim)" }}>
              {usedSeats} / {totalSeats} seats used
              {pendingUser && <> · Inviting <span className="font-medium">{pendingUser.email}</span></>}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 mt-0.5" style={{ color: "var(--t-text-dim)" }}>
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
            Additional seats
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAdditionalSeats((n) => Math.max(1, n - 1))}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-colors"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums" style={{ color: "var(--t-text-primary)" }}>
              {additionalSeats}
            </span>
            <button
              onClick={() => setAdditionalSeats((n) => n + 1)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-colors"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
            >
              +
            </button>
            <span className="text-xs ml-1" style={{ color: "var(--t-text-dim)" }}>
              {currentTotal} → {newTotal} total
            </span>
          </div>
        </div>

        <div className="rounded-xl px-4 py-3 space-y-1" style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: "var(--t-text-secondary)" }}>{newTotal} seats × ${SEAT_PRICE_MONTHLY}/mo</span>
            <span className="font-semibold tabular-nums" style={{ color: "var(--t-text-primary)" }}>${monthlyCost}/mo</span>
          </div>
          <p className="text-[11px]" style={{ color: "var(--t-text-dim)" }}>
            Prorated charge applied immediately for the current billing period.
          </p>
        </div>

        {error && (
          <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-secondary)", border: "1px solid var(--t-border)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={loading}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
            style={{ background: "var(--t-accent)", opacity: loading ? 0.6 : 1 }}
          >
            {loading
              ? <span className="flex items-center justify-center gap-1.5">
                  <Icon icon="lucide:loader-2" width={13} className="animate-spin" />
                  Processing…
                </span>
              : `Buy ${additionalSeats} seat${additionalSeats !== 1 ? "s" : ""} & Invite`
            }
          </button>
        </div>
      </div>
    </div>
  );
}
