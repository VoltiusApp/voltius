import { useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { changeMasterPassword } from "@/services/account";
import { SettingsInput } from "./shared";

interface Props {
  onClose: () => void;
}

export default function ChangeMasterPasswordModal({ onClose }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setError("Current password is required");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must differ from the current one");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await changeMasterPassword(currentPassword, newPassword);
      setDone(true);
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
          <h2 className="text-sm font-semibold text-(--t-text-primary)">Change master password</h2>
          <button
            onClick={onClose}
            className="text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
          >
            <Icon icon="lucide:x" width={14} />
          </button>
        </div>

        {done ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-(--t-status-connected)">
              <Icon icon="lucide:check-circle" width={14} />
              <p className="text-xs font-medium">Password changed successfully.</p>
            </div>
            <p className="text-xs text-(--t-text-dim)">
              You are still logged in. Your vault entries are unchanged.
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
            <SettingsInput
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoFocus
            />
            <SettingsInput
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPassword}
              onChange={setNewPassword}
            />
            <SettingsInput
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
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
                {loading ? "Changing…" : "Change password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
