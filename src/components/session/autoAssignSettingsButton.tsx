"use client";
import { Session } from "@/types/player";
import { useMemo, useState } from "react";
import { BalanceGenderToggle } from "@/components/session/balanceGenderToggle";
import { BlacklistEditor } from "@/components/session/blacklistEditor";
import { ExcludeEditor } from "@/components/session/excludeEditor";
import { useStore } from "@/lib/store";

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
  const updateSessionConfig = useStore((s) => s.updateSessionConfig as any);
  const cfg = session.autoAssignConfig || {};
  const defaults = useMemo(
    () => ({
      closeW: 5000,
      withinW: 500,
      partnerRepeatW: 50,
      oppRepeatW: 100,
      restW: 150,
      fairnessW: 1,
      genderSoftPenalty: 500,
      randomW: 0,
    }),
    []
  );
  const weights = { ...defaults, ...(cfg.weights || {}) } as Record<
    string,
    number
  >;
  const setCfg = (partial: any) => {
    updateSessionConfig(session.id, partial);
  };
  const setWeight = (key: keyof typeof weights, value: number) => {
    const next = { ...(cfg.weights || {}) } as Record<string, number>;
    next[key] = value;
    setCfg({ weights: next });
  };
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${
        open ? "" : "hidden"
      }`}
    >
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
          <div>
            <div className="mb-1 text-sm font-medium">Advanced</div>
            <div className="mb-2 text-[11px] text-gray-500">
              Tune competitive matching. Changes apply immediately.
            </div>
            <div className="grid grid-cols-1 gap-2">
              <label className="flex items-center justify-between rounded-xl border p-2 text-sm">
                <span>Priority preset</span>
                <select
                  className="rounded border px-2 py-1 text-xs"
                  value={cfg.priority || "competitiveness"}
                  onChange={(e) => setCfg({ priority: e.target.value })}
                >
                  <option value="competitiveness">Competitiveness</option>
                  <option value="variety">Variety</option>
                  <option value="rest">Rest</option>
                </select>
              </label>
              <label className="flex items-center justify-between rounded-xl border p-2 text-sm">
                <span>Respect gender</span>
                <select
                  className="rounded border px-2 py-1 text-xs"
                  value={
                    cfg.respectGender ||
                    (cfg.balanceGender ?? true ? "soft" : "off")
                  }
                  onChange={(e) => setCfg({ respectGender: e.target.value })}
                >
                  <option value="hard">Hard</option>
                  <option value="soft">Soft</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label className="flex items-center justify-between rounded-xl border p-2 text-sm">
                <span>Blacklist mode</span>
                <select
                  className="rounded border px-2 py-1 text-xs"
                  value={cfg.blacklistMode || "hard"}
                  onChange={(e) => setCfg({ blacklistMode: e.target.value })}
                >
                  <option value="hard">Hard</option>
                  <option value="soft">Soft</option>
                </select>
              </label>
              <div className="grid grid-cols-1 gap-2">
                {[
                  ["closeW", "Closeness weight"],
                  ["withinW", "Within-team imbalance weight"],
                  ["partnerRepeatW", "Partner repeat weight"],
                  ["oppRepeatW", "Opponent repeat weight"],
                  ["restW", "Rest weight"],
                  ["fairnessW", "Fairness (games played) weight"],
                  ["genderSoftPenalty", "Gender soft penalty"],
                  ["randomW", "Randomness weight"],
                ].map(([k, label]) => (
                  <label
                    key={k}
                    className="flex items-center justify-between rounded-xl border p-2 text-sm"
                  >
                    <span>{label}</span>
                    <input
                      type="number"
                      className="w-24 rounded border px-2 py-1 text-xs"
                      value={Number(weights[k as keyof typeof weights] || 0)}
                      onChange={(e) =>
                        setWeight(k as any, Number(e.target.value))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <label className="flex items-center justify-between rounded-xl border p-2 text-sm">
                  <span>Max K (singles candidates)</span>
                  <input
                    type="number"
                    className="w-24 rounded border px-2 py-1 text-xs"
                    value={Number(cfg.maxKSingles ?? 12)}
                    onChange={(e) =>
                      setCfg({
                        maxKSingles: Math.max(2, Number(e.target.value) || 12),
                      })
                    }
                  />
                </label>
                <label className="flex items-center justify-between rounded-xl border p-2 text-sm">
                  <span>Max K (doubles candidates)</span>
                  <input
                    type="number"
                    className="w-24 rounded border px-2 py-1 text-xs"
                    value={Number(cfg.maxKDoubles ?? 12)}
                    onChange={(e) =>
                      setCfg({
                        maxKDoubles: Math.max(4, Number(e.target.value) || 12),
                      })
                    }
                  />
                </label>
              </div>
            </div>
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
