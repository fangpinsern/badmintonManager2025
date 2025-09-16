"use client";
import { Session } from "@/types/player";
import { useStore } from "@/lib/store";

function BalanceGenderToggle({ session }: { session: Session }) {
  const enabled = session.autoAssignConfig?.balanceGender ?? true;
  const update = (checked: boolean) => {
    useStore.setState((state) => ({
      sessions: state.sessions.map((ss) =>
        ss.id === session.id
          ? {
              ...ss,
              autoAssignConfig: {
                ...(ss.autoAssignConfig || {}),
                balanceGender: checked,
              },
            }
          : ss
      ),
    }));
  };
  return (
    <label className="flex items-center justify-between rounded-xl border border-gray-200 p-2">
      <span className="text-sm">Balance gender on doubles</span>
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={enabled}
        onChange={(e) => update(e.target.checked)}
      />
    </label>
  );
}

export { BalanceGenderToggle };
