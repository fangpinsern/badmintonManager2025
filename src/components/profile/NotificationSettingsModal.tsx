"use client";
import { Input, Label } from "@/components/layout";
import React from "react";

function NotificationSettingsModal({
  open,
  email,
  onEmailChange,
  allowCalendarInvites,
  onToggleCalendarInvites,
  onCancel,
  onSave,
  saving = false,
}: {
  open: boolean;
  email: string;
  onEmailChange: (v: string) => void;
  allowCalendarInvites: boolean;
  onToggleCalendarInvites: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">
          Notification settings
        </div>
        <div className="space-y-3">
          <Input
            label="Notification email"
            placeholder="you@example.com"
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
          />
          <div className="flex items-center justify-between rounded-xl border border-gray-200 p-2">
            <div>
              <div className="font-medium">Allow calendar invites</div>
              <div className="text-[11px] text-gray-600">
                Receive calendar invites at this email
              </div>
            </div>
            <button
              className={`rounded-full border px-3 py-1 text-xs ${
                allowCalendarInvites ? "bg-blue-600 text-white" : ""
              }`}
              onClick={onToggleCalendarInvites}
            >
              {allowCalendarInvites ? "On" : "Off"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default NotificationSettingsModal;
