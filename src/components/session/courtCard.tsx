"use client";
import { ScoreModal } from "@/components/session/scoreModal";
import { ConfirmModal } from "@/components/session/confirmModal";
import { Session, Court } from "@/types/player";
import { useStore } from "@/lib/store";
import { useState, useMemo } from "react";
import { auth } from "@/lib/firebase";
import { Select } from "@/components/layout";

function CourtCard({
  session,
  court,
  idx,
  isOrganizer,
}: {
  session: Session;
  court: Court;
  idx: number;
  isOrganizer?: boolean;
}) {
  const endGame = useStore((s) => s.endGame);
  const voidGame = useStore((s) => s.voidGame);
  const setPair = useStore((s) => s.setPlayerPair);
  const assign = useStore((s) => s.assignPlayerToCourt);
  const startGame = useStore((s) => s.startGame);
  const setCourtMode = useStore((s) => s.setCourtMode);
  const removeCourt = useStore((s) => s.removeCourt);
  const enqueue = useStore((s) => s.enqueueToCourt);
  const dequeue = useStore((s) => s.removeFromCourtQueue);
  const clearQueue = useStore((s) => s.clearCourtQueue);
  // Auto-fill is now always enabled by default; toggle removed

  const canEndAny = court.playerIds.length > 0;
  const pairA = court.pairA || [];
  const pairB = court.pairB || [];
  const isSingles = (court.mode || "doubles") === "singles";
  const requiredPerTeam = isSingles ? 1 : 2;
  const ready =
    pairA.length === requiredPerTeam && pairB.length === requiredPerTeam;
  const available = court.playerIds.filter(
    (pid) => !pairA.includes(pid) && !pairB.includes(pid)
  );
  const isFull = court.playerIds.length === requiredPerTeam * 2;
  const sideLabel = isSingles ? "Player" : "Pair";

  const [open, setOpen] = useState(false);
  const [scoreA, setScoreA] = useState<string>("");
  const [scoreB, setScoreB] = useState<string>("");
  const scoreValid =
    scoreA.trim() !== "" &&
    scoreB.trim() !== "" &&
    !Number.isNaN(Number(scoreA)) &&
    !Number.isNaN(Number(scoreB));
  const [removeOpen, setRemoveOpen] = useState(false);
  const [queueAdds, setQueueAdds] = useState<string[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);

  // Detect if any player on this court is currently in another ongoing match (other courts)
  const busyElsewhere = useMemo(() => {
    const set = new Set<string>();
    session.courts.forEach((cc, i) => {
      if (i === idx) return;
      if (!cc.inProgress) return;
      cc.playerIds.forEach((pid) => set.add(pid));
    });
    return set;
  }, [session.courts, idx]);
  const blockingBusyIds = court.playerIds.filter((pid) =>
    busyElsewhere.has(pid)
  );
  const hasBusyElsewhere = blockingBusyIds.length > 0;

  // Compute how many times two players have previously been on the same side (pair) in past games
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const sameSideMap = useMemo(() => {
    const m: Map<string, number> = new Map();
    for (const g of session.games || []) {
      const sides: string[][] = [g.sideA || [], g.sideB || []];
      for (const side of sides) {
        for (let i = 0; i < side.length; i++) {
          for (let j = i + 1; j < side.length; j++) {
            const key = pairKey(side[i], side[j]);
            m.set(key, (m.get(key) || 0) + 1);
          }
        }
      }
    }
    return m;
  }, [session.games]);
  const getPairedCount = (a: string, b: string): number =>
    sameSideMap.get(pairKey(a, b)) || 0;

  const inProgressIds = useMemo(() => {
    const set = new Set<string>();
    for (const cc of session.courts) {
      if (!cc.inProgress) continue;
      for (const pid of cc.playerIds) set.add(pid);
    }
    return set;
  }, [session.courts]);

  const onSave = () => {
    const aStr = scoreA.trim();
    const bStr = scoreB.trim();
    const a = Number(aStr);
    const b = Number(bStr);
    if (!ready) return;
    if (aStr === "" || bStr === "") return;
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    endGame(session.id, idx, a, b);
    setScoreA("");
    setScoreB("");
    setOpen(false);
  };

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">Court {idx + 1}</div>
        {!session.ended && !court.inProgress && isOrganizer && (
          <button
            onClick={() => setRemoveOpen(true)}
            aria-label="Remove court"
            className="rounded-md p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M9 3a1 1 0 0 0-1 1v1H5.5a.75.75 0 0 0 0 1.5h.59l.84 12.06A2.25 2.25 0 0 0 9.18 21h5.64a2.25 2.25 0 0 0 2.25-2.44L17.91 6.5h.59a.75.75 0 0 0 0-1.5H16V4a1 1 0 0 0-1-1H9Zm1 2h4V4H10v1Zm-.82 14a.75.75 0 0 1-.75-.68L7.62 6.5h8.76l-.81 11.82a.75.75 0 0 1-.75.68H9.18ZM10 9.25a.75.75 0 0 1 .75.75v7a.75.75 0 0 1-1.5 0v-7c0-.41.34-.75.75-.75Zm4 0c.41 0 .75.34.75.75v7a.75.75 0 0 1-1.5 0v-7c0-.41.34-.75.75-.75Z" />
            </svg>
          </button>
        )}
      </div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">
          {court.playerIds.length}/
          {(court.mode || "doubles") === "singles" ? 2 : 4}
        </div>
        <div className="flex items-center gap-2">
          {court.inProgress && (
            <div className="text-[11px] text-gray-500">
              Queued: {(court.queue || []).length}
            </div>
          )}
          {!session.ended && !court.inProgress && isOrganizer && (
            <button
              onClick={() =>
                useStore.getState().autoAssignCourt(session.id, idx)
              }
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              Auto-assign
            </button>
          )}
          {/* Remove button moved to top-right icon */}
          {!court.inProgress && isOrganizer && (
            <Select
              value={court.mode || "doubles"}
              onChange={(v) =>
                setCourtMode(session.id, idx, v as "singles" | "doubles")
              }
              disabled={!!session.ended}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="singles">Singles</option>
              <option value="doubles">Doubles</option>
            </Select>
          )}
          {!court.inProgress ? (
            <button
              onClick={() => {
                startGame(session.id, idx);
                setOpen(false);
              }}
              disabled={
                !isOrganizer ||
                !ready ||
                !isFull ||
                !!session.ended ||
                hasBusyElsewhere
              }
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 disabled:opacity-50"
              title={
                hasBusyElsewhere
                  ? "Players are still in another game"
                  : undefined
              }
            >
              Start game
            </button>
          ) : (
            <button
              onClick={() => setOpen(true)}
              disabled={!!session.ended || !isOrganizer}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
            >
              End game
            </button>
          )}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs font-medium">
            {sideLabel} A ({pairA.length}/{requiredPerTeam})
            {!isSingles && pairA.length === 2 ? (
              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700">
                paired {getPairedCount(pairA[0], pairA[1])}×
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            {pairA.length === 0 && (
              <div className="text-xs text-gray-400">No players in A</div>
            )}
            {pairA.map((pid) => {
              const player = session.players.find((pp) => pp.id === pid);
              if (!player) return null;
              return (
                <div
                  key={pid}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-2 py-1 text-sm"
                >
                  <span className="truncate">{player.name}</span>
                  {busyElsewhere.has(pid) && (
                    <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">
                      in other game
                    </span>
                  )}
                  {isOrganizer && (
                    <button
                      onClick={() => setPair(session.id, idx, pid, null)}
                      className="text-[10px] text-gray-600"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium">
            {sideLabel} B ({pairB.length}/{requiredPerTeam})
            {!isSingles && pairB.length === 2 ? (
              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700">
                paired {getPairedCount(pairB[0], pairB[1])}×
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            {pairB.length === 0 && (
              <div className="text-xs text-gray-400">No players in B</div>
            )}
            {pairB.map((pid) => {
              const player = session.players.find((pp) => pp.id === pid);
              if (!player) return null;
              return (
                <div
                  key={pid}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-2 py-1 text-sm"
                >
                  <span className="truncate">{player.name}</span>
                  {busyElsewhere.has(pid) && (
                    <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">
                      in other game
                    </span>
                  )}
                  <button
                    onClick={() => setPair(session.id, idx, pid, null)}
                    className="text-[10px] text-gray-600"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!court.inProgress && hasBusyElsewhere && (
        <div className="-mt-1 mb-2 text-[11px] text-rose-700">
          Waiting for:{" "}
          {blockingBusyIds
            .map(
              (pid) =>
                session.players.find((pp) => pp.id === pid)?.name || "(deleted)"
            )
            .join(", ")}
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-medium">
          Available on court ({available.length})
        </div>
        {available.length === 0 ? (
          <div className="text-xs text-gray-400">No available players</div>
        ) : (
          <ul className="space-y-1">
            {available.map((pid) => {
              const player = session.players.find((pp) => pp.id === pid);
              if (!player) return null;
              const canAddA =
                pairA.length < requiredPerTeam &&
                !session.ended &&
                !court.inProgress;
              const canAddB =
                pairB.length < requiredPerTeam &&
                !session.ended &&
                !court.inProgress;
              return (
                <li
                  key={pid}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="truncate rounded-lg bg-gray-50 px-2 py-1 text-sm">
                    {player.name}
                  </div>
                  <div className="flex items-center gap-1">
                    {isOrganizer && (
                      <button
                        onClick={() => setPair(session.id, idx, pid, "A")}
                        disabled={!canAddA}
                        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                      >
                        A
                      </button>
                    )}
                    {pairA.length === 1 && (
                      <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{`paired ${getPairedCount(
                        pairA[0],
                        pid
                      )}×`}</span>
                    )}
                    {isOrganizer && (
                      <button
                        onClick={() => setPair(session.id, idx, pid, "B")}
                        disabled={!canAddB}
                        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                      >
                        B
                      </button>
                    )}
                    {pairB.length === 1 && (
                      <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{`paired ${getPairedCount(
                        pairB[0],
                        pid
                      )}×`}</span>
                    )}
                    {isOrganizer && (
                      <button
                        onClick={() => assign(session.id, pid, null)}
                        disabled={!!session.ended || !!court.inProgress}
                        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                      >
                        Unassign
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Queue management (only while a game is ongoing) */}
      {court.inProgress && isOrganizer && (
        <div className="mt-3 rounded-lg border">
          <button
            type="button"
            onClick={() => setQueueOpen(!queueOpen)}
            className="flex w-full items-center justify-between px-2 py-2"
          >
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium">Next up queue</div>
              <span className="text-[11px] text-gray-500">
                ({(court.queue || []).length})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {queueOpen ? "▾" : "▸"}
              </span>
            </div>
          </button>
          {queueOpen && (
            <div className="border-t p-2">
              {(court.queue || []).length === 0 ? (
                <div className="text-[11px] text-gray-500">No one queued.</div>
              ) : (
                <ul className="space-y-1">
                  {(court.queue || []).map((pid) => {
                    const p = session.players.find((pp) => pp.id === pid);
                    const name = p?.name || "(deleted)";
                    // show pair count hint vs any already selected in nextA/nextB
                    const nextAFirst =
                      !isSingles && (court.nextA || []).length === 1
                        ? (court.nextA as string[])[0]
                        : null;
                    const nextBFirst =
                      !isSingles && (court.nextB || []).length === 1
                        ? (court.nextB as string[])[0]
                        : null;
                    return (
                      <li
                        key={`q-${pid}`}
                        className="grid grid-cols-12 items-center gap-2"
                      >
                        <div className="col-span-3 truncate text-sm">
                          {name}
                        </div>
                        <div className="col-span-6 flex items-center justify-between w-full">
                          <div className="text-right text-[10px] text-gray-600 w-1/4">
                            {nextAFirst
                              ? `paired ${getPairedCount(nextAFirst, pid)}×`
                              : ""}
                          </div>
                          <div className="flex items-center justify-center gap-1 w-1/2">
                            <button
                              onClick={() => {
                                const selected = (court.nextA || []).includes(
                                  pid
                                );
                                useStore
                                  .getState()
                                  .setNextPair(
                                    session.id,
                                    idx,
                                    pid,
                                    selected ? null : "A"
                                  );
                              }}
                              className={`rounded border px-2 py-0.5 text-sm ${
                                (court.nextA || []).includes(pid)
                                  ? "bg-gray-200"
                                  : ""
                              }`}
                            >
                              A
                            </button>
                            <button
                              onClick={() => {
                                const selected = (court.nextB || []).includes(
                                  pid
                                );
                                useStore
                                  .getState()
                                  .setNextPair(
                                    session.id,
                                    idx,
                                    pid,
                                    selected ? null : "B"
                                  );
                              }}
                              className={`rounded border px-2 py-0.5 text-sm ${
                                (court.nextB || []).includes(pid)
                                  ? "bg-gray-200"
                                  : ""
                              }`}
                            >
                              B
                            </button>
                          </div>
                          <div className="text-[10px] text-gray-600 w-1/4">
                            {nextBFirst
                              ? `paired ${getPairedCount(nextBFirst, pid)}×`
                              : ""}
                          </div>
                        </div>
                        <div className="col-span-3 flex justify-end">
                          <button
                            onClick={() => {
                              dequeue(session.id, idx, pid);
                            }}
                            className="rounded border px-2 py-0.5 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1">
                  {(() => {
                    const alreadyQueuedSet = new Set(court.queue || []);
                    const queuedElsewhere = new Set<string>();
                    session.courts.forEach((cc, j) => {
                      if (j !== idx)
                        (cc.queue || []).forEach((pid) =>
                          queuedElsewhere.add(pid)
                        );
                    });
                    const selectable = session.players.filter((p) => {
                      if (alreadyQueuedSet.has(p.id)) return false;
                      if (queuedElsewhere.has(p.id)) return false;
                      // block if player is assigned to any court not yet started
                      if (
                        session.courts.some(
                          (cc) => !cc.inProgress && cc.playerIds.includes(p.id)
                        )
                      )
                        return false;
                      return true;
                    });
                    const avail = selectable.filter(
                      (p) => !inProgressIds.has(p.id)
                    );
                    const inGameAvail = selectable.filter((p) =>
                      inProgressIds.has(p.id)
                    );
                    if (selectable.length === 0) {
                      return (
                        <div className="text-[11px] text-gray-500">
                          No available players to queue.
                        </div>
                      );
                    }
                    return (
                      <div className="max-h-48 overflow-auto space-y-2">
                        {avail.length > 0 && (
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-gray-700">
                              Available ({avail.length})
                            </div>
                            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                              {avail.map((p) => {
                                const checked = queueAdds.includes(p.id);
                                return (
                                  <label
                                    key={`qa-${p.id}`}
                                    className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-xs"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked)
                                          setQueueAdds((prev) =>
                                            prev.includes(p.id)
                                              ? prev
                                              : [...prev, p.id]
                                          );
                                        else
                                          setQueueAdds((prev) =>
                                            prev.filter((id) => id !== p.id)
                                          );
                                      }}
                                    />
                                    <span className="truncate">{p.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {inGameAvail.length > 0 && (
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-gray-700">
                              In game ({inGameAvail.length})
                            </div>
                            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                              {inGameAvail.map((p) => {
                                const checked = queueAdds.includes(p.id);
                                return (
                                  <label
                                    key={`qi-${p.id}`}
                                    className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-xs"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked)
                                          setQueueAdds((prev) =>
                                            prev.includes(p.id)
                                              ? prev
                                              : [...prev, p.id]
                                          );
                                        else
                                          setQueueAdds((prev) =>
                                            prev.filter((id) => id !== p.id)
                                          );
                                      }}
                                    />
                                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">
                                      in game
                                    </span>
                                    <span className="truncate">{p.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <button
                  onClick={() => {
                    if (!queueAdds.length) return;
                    for (const pid of queueAdds) enqueue(session.id, idx, pid);
                    setQueueAdds([]);
                  }}
                  className="rounded border px-2 py-1 text-xs"
                >
                  Queue selected
                </button>
                {(court.queue || []).length > 0 && (
                  <button
                    onClick={() => clearQueue(session.id, idx)}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Clear
                  </button>
                )}
              </div>
              {
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-gray-700">
                      Next A ({(court.nextA || []).length}/{requiredPerTeam})
                      {!isSingles && (court.nextA || []).length === 2 ? (
                        <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5">
                          paired{" "}
                          {getPairedCount(
                            (court.nextA as string[])[0],
                            (court.nextA as string[])[1]
                          )}
                          ×
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px] text-gray-700">
                      {(court.nextA || []).map((pid) => (
                        <span
                          key={`na-${pid}`}
                          className="rounded bg-gray-100 px-1.5 py-0.5"
                        >
                          {session.players.find((pp) => pp.id === pid)?.name ||
                            "(deleted)"}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-gray-700">
                      Next B ({(court.nextB || []).length}/{requiredPerTeam})
                      {!isSingles && (court.nextB || []).length === 2 ? (
                        <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5">
                          paired{" "}
                          {getPairedCount(
                            (court.nextB as string[])[0],
                            (court.nextB as string[])[1]
                          )}
                          ×
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px] text-gray-700">
                      {(court.nextB || []).map((pid) => (
                        <span
                          key={`nb-${pid}`}
                          className="rounded bg-gray-100 px-1.5 py-0.5"
                        >
                          {session.players.find((pp) => pp.id === pid)?.name ||
                            "(deleted)"}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              }
              <div className="mt-2">
                <button
                  onClick={() =>
                    useStore.getState().autoAssignNext(session.id, idx)
                  }
                  className="rounded border px-2 py-1 text-xs"
                >
                  Auto-assign next teams
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Read-only view of queued next pairs for all users (including non-organizers) */}
      {!isOrganizer &&
        ((court.nextA || []).length > 0 || (court.nextB || []).length > 0) && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-[11px] font-medium text-gray-700">
                Next A ({(court.nextA || []).length}/{requiredPerTeam})
              </div>
              <div className="flex flex-wrap gap-1 text-[11px] text-gray-700">
                {(court.nextA || []).map((pid) => {
                  const pl = session.players.find((pp) => pp.id === pid);
                  const nm = pl?.name || "(deleted)";
                  const isLinkedToViewer =
                    !!pl?.accountUid &&
                    pl?.accountUid === auth.currentUser?.uid;
                  return (
                    <span
                      key={`ro-na-${pid}`}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-sm"
                    >
                      <span className={isLinkedToViewer ? "font-bold" : ""}>
                        {nm}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-gray-700">
                Next B ({(court.nextB || []).length}/{requiredPerTeam})
              </div>
              <div className="flex flex-wrap gap-1 text-[11px] text-gray-700">
                {(court.nextB || []).map((pid) => {
                  const pl = session.players.find((pp) => pp.id === pid);
                  const nm = pl?.name || "(deleted)";
                  const isLinkedToViewer =
                    !!pl?.accountUid &&
                    pl?.accountUid === auth.currentUser?.uid;
                  return (
                    <span
                      key={`ro-nb-${pid}`}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-sm"
                    >
                      <span className={isLinkedToViewer ? "font-bold" : ""}>
                        {nm}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      <ScoreModal
        open={open}
        sideLabel={sideLabel}
        requiredPerTeam={requiredPerTeam}
        ready={ready}
        scoreA={scoreA}
        scoreB={scoreB}
        onChangeA={setScoreA}
        onChangeB={setScoreB}
        onCancel={() => setOpen(false)}
        onSave={onSave}
        onVoid={() => {
          voidGame(session.id, idx);
          setOpen(false);
        }}
        namesA={pairA.map(
          (pid) =>
            session.players.find((pp) => pp.id === pid)?.name || "(deleted)"
        )}
        namesB={pairB.map(
          (pid) =>
            session.players.find((pp) => pp.id === pid)?.name || "(deleted)"
        )}
      />

      <ConfirmModal
        open={removeOpen}
        title={`Remove Court ${idx + 1}?`}
        body="Players on this court will be unassigned. This cannot be undone."
        confirmText="Remove court"
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => {
          removeCourt(session.id, idx);
          setRemoveOpen(false);
        }}
      />
    </div>
  );
}

export { CourtCard };
