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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
          <div className="rounded-xl border p-2">
            <div className="flex items-center justify-between text-sm">
              <span>Auto Assign preset</span>
              <select
                className="rounded border px-2 py-1 text-xs"
                value={cfg.priority || "variety"}
                onChange={(e) => setCfg({ priority: e.target.value })}
              >
                <option value="competitiveness">Competitiveness</option>
                <option value="variety">Variety</option>
                <option value="rest">Rest</option>
              </select>
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              Choose the primary objective for auto-assignment.
            </div>
          </div>
          <div className="border p-2 rounded-xl">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="mb-1 flex w-full items-center justify-between text-sm font-medium"
              aria-expanded={advancedOpen}
              aria-controls="auto-assign-advanced"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">
                  {advancedOpen ? "▾" : "▸"}
                </span>
                <span>Advanced</span>
              </span>
            </button>
            <div className="text-[11px] text-gray-500">
              Tune competitive matching. Changes apply immediately.
            </div>
            {advancedOpen && (
              <div
                id="auto-assign-advanced"
                className="grid grid-cols-1 gap-2 mt-2"
              >
                <div className="rounded-xl border p-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Respect gender</span>
                    <select
                      className="rounded border px-2 py-1 text-xs"
                      value={
                        cfg.respectGender ||
                        (cfg.balanceGender ?? true ? "soft" : "off")
                      }
                      onChange={(e) =>
                        setCfg({ respectGender: e.target.value })
                      }
                    >
                      <option value="hard">Hard</option>
                      <option value="soft">Soft</option>
                      <option value="off">Off</option>
                    </select>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    How strictly gender balance is enforced.
                  </div>
                </div>
                <div className="rounded-xl border p-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Blacklist mode</span>
                    <select
                      className="rounded border px-2 py-1 text-xs"
                      value={cfg.blacklistMode || "hard"}
                      onChange={(e) =>
                        setCfg({ blacklistMode: e.target.value })
                      }
                    >
                      <option value="hard">Hard</option>
                      <option value="soft">Soft</option>
                    </select>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    Hard prevents, Soft penalizes blacklisted pairings.
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    [
                      "closeW",
                      "Closeness weight",
                      "Favor closer skill matchups.",
                    ],
                    [
                      "withinW",
                      "Within-team imbalance weight",
                      "Penalize imbalance within the same team.",
                    ],
                    [
                      "partnerRepeatW",
                      "Partner repeat weight",
                      "Discourage repeating the same partner.",
                    ],
                    [
                      "oppRepeatW",
                      "Opponent repeat weight",
                      "Discourage repeating the same opponent.",
                    ],
                    ["restW", "Rest weight", "Reward longer-rested players."],
                    [
                      "fairnessW",
                      "Fairness (games played) weight",
                      "Balance total games across players.",
                    ],
                    [
                      "genderSoftPenalty",
                      "Gender soft penalty",
                      "Penalty when gender preference is not met.",
                    ],
                    [
                      "randomW",
                      "Randomness weight",
                      "Add randomness to avoid stale matchups.",
                    ],
                  ].map(([k, label, hint]) => (
                    <div key={k} className="rounded-xl border p-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>{label as string}</span>
                        <input
                          type="number"
                          className="w-24 rounded border px-2 py-1 text-xs"
                          value={Number(
                            weights[k as keyof typeof weights] || 0
                          )}
                          onChange={(e) =>
                            setWeight(k as any, Number(e.target.value))
                          }
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500">
                        {hint as string}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="rounded-xl border p-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Max K (singles candidates)</span>
                      <input
                        type="number"
                        className="w-24 rounded border px-2 py-1 text-xs"
                        value={Number(cfg.maxKSingles ?? 12)}
                        onChange={(e) =>
                          setCfg({
                            maxKSingles: Math.max(
                              2,
                              Number(e.target.value) || 12
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      Limit number of top candidates considered for singles.
                    </div>
                  </div>
                  <div className="rounded-xl border p-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Max K (doubles candidates)</span>
                      <input
                        type="number"
                        className="w-24 rounded border px-2 py-1 text-xs"
                        value={Number(cfg.maxKDoubles ?? 12)}
                        onChange={(e) =>
                          setCfg({
                            maxKDoubles: Math.max(
                              4,
                              Number(e.target.value) || 12
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      Limit number of top candidates considered for doubles.
                    </div>
                  </div>
                </div>
              </div>
            )}
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
