"use client";
import { useState } from "react";

export function UsernameModal({
  open,
  onClose,
  onSubmit,
  canCancel = true,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (username: string) => Promise<void> | void;
  canCancel?: boolean;
}) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function submit() {
    const val = username.trim().toLowerCase();
    if (val.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onSubmit(val);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Unable to claim username.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[90vw] max-w-md rounded-2xl bg-white p-4 shadow">
        <div className="mb-2 text-base font-semibold">Choose a username</div>
        <div className="mb-2 text-xs text-gray-600">
          Pick a unique username for your account. It will be visible to
          organizers and other players.
        </div>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. shuttlemaster"
          className="w-full rounded border px-3 py-2 text-sm outline-none"
          disabled={loading}
        />
        {error && <div className="mt-2 text-[11px] text-red-600">{error}</div>}
        <div className="mt-3 flex items-center justify-end gap-2">
          {canCancel && (
            <button
              onClick={onClose}
              className="rounded border px-3 py-1.5 text-xs"
              disabled={loading}
            >
              Cancel
            </button>
          )}
          <button
            onClick={submit}
            className="rounded bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UsernameModal;
