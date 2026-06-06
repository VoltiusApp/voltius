import { useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { changeEmail } from "@/services/account";
import { useNotificationStore } from "@/stores/notificationStore";
import { SettingsInput } from "./shared";

interface Props {
  currentEmail: string;
  onClose: () => void;
}

export default function EditEmailModal({ currentEmail, onClose }: Props) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const addToast = useNotificationStore((s) => s.addToast);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newEmail.includes("@")) {
      setError("Invalid email address");
      return;
    }
    if (newEmail === currentEmail) {
      setError("New email must differ from the current one");
      return;
    }
    if (!password) {
      setError("Password is required to confirm the change");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await changeEmail(newEmail, password);
      setDone(true);
      addToast({
        pluginId: "system",
        pluginName: "Voltius",
        type: "toast",
        message: `Verification email sent to ${newEmail}.`,
        severity: "info",
        duration: 5000,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-xl p-5 shadow-2xl bg-(--t-bg-terminal) border border-(--t-border)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-(--t-text-primary)">Change email</h2>
          <button
            onClick={onClose}
            className="text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
          >
            <Icon icon="lucide:x" width={14} />
          </button>
        </div>

        {done ? (
          <div className="space-y-3">
            <p className="text-xs text-(--t-text-muted)">
              Email updated to <strong className="text-(--t-text-primary)">{newEmail}</strong>.
              Check your inbox for a verification link.
            </p>
            <p className="text-xs text-(--t-text-dim)">
              Until verified, paid features will be paused.
            </p>
            <button
              onClick={onClose}
              className="w-full py-1.5 rounded-lg text-sm font-medium text-white bg-(--t-accent)"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-2">
            <p className="text-xs text-(--t-text-dim) mb-3">
              Current: <span className="text-(--t-text-muted)">{currentEmail}</span>
            </p>
            <SettingsInput
              type="email"
              placeholder="New email address"
              value={newEmail}
              onChange={setNewEmail}
              autoFocus
            />
            <SettingsInput
              type="password"
              placeholder="Current master password"
              value={password}
              onChange={setPassword}
            />
            {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-1.5 rounded-lg text-sm transition-colors bg-(--t-bg-elevated) text-(--t-text-muted)"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-1.5 rounded-lg text-sm font-medium text-white transition-colors bg-(--t-accent)"
                style={{ opacity: loading ? 0.7 : 1 }}
              >
                {loading ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
