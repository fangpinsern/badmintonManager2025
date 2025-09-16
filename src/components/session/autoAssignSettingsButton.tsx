"use client";
import { Session } from "@/types/player";
import { useState } from "react";
import { BalanceGenderToggle } from "@/components/session/balanceGenderToggle";
import { BlacklistEditor } from "@/components/session/blacklistEditor";
import { ExcludeEditor } from "@/components/session/excludeEditor";

function AutoAssignSettingsButton({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
      >
        Auto-assign settings
      </button>
      <AutoAssignSettingsModal
        open={open}
        session={session}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function AutoAssignSettingsModal({
  open,
  session,
  onClose,
}: {
  open: boolean;
  session: Session;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">Auto-assign settings</div>
        <div className="mb-3 text-xs text-gray-500">
          Configure the rules used when auto-assigning players to courts.
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-medium">Basic</div>
            <div className="mb-2 text-[11px] text-gray-500">
              Quick toggles to influence auto-assign behavior.
            </div>
            <BalanceGenderToggle session={session} />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">
              Blacklist pairs (doubles)
            </div>
            <div className="mb-2 text-[11px] text-gray-500">
              Avoid specific pairings when forming doubles teams.
            </div>
            <BlacklistEditor session={session} />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Excluded players</div>
            <div className="mb-2 text-[11px] text-gray-500">
              Players in this list will be ignored by auto-assign.
            </div>
            <ExcludeEditor session={session} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end">
          <button
            onClick={onClose}
            className="rounded-xl border px-3 py-1.5 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export { AutoAssignSettingsButton };
