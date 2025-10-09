import React from "react";
import { Card } from "@/components/layout";
import { formatSessionTitle } from "@/lib/helper";
import type { Session } from "@/types/player";
import { auth } from "@/lib/firebase";

export function SessionCard({
  session,
  onOpen,
  rightActions,
}: {
  session: Session;
  onOpen: (sessionId: string) => void;
  rightActions?: React.ReactNode;
}) {
  const me = auth.currentUser?.uid || null;
  const owner =
    (typeof window !== "undefined" &&
      (window as any).__sessionOwners?.get?.(session.id)) ||
    null;
  const isOrganizer = owner && me ? owner === me : false;
  const nowIsoDate = new Date().toISOString().slice(0, 10);
  const isToday = session.date === nowIsoDate;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium flex items-center gap-2">
            <span>{formatSessionTitle(session)}</span>
            {session.clubId ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                Club
              </span>
            ) : null}
            {typeof session.playerLimit === "number" &&
              session.playerLimit > 0 &&
              (() => {
                const left = Math.max(
                  0,
                  session.playerLimit - session.players.length
                );
                return (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                    {left === 0 ? "Session is full" : `${left} slots left`}
                  </span>
                );
              })()}
            <div className="flex flex-col items-end gap-1">
              {isToday && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                  Today
                </span>
              )}
              {((session.players || []).filter((p) => p.accountUid === me)
                .length > 0 ||
                isOrganizer) && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    isOrganizer
                      ? "bg-blue-50 text-blue-700"
                      : (session.coOrganizerUids || []).includes(me || "")
                      ? "bg-red-50 text-red-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {isOrganizer
                    ? "Organizer"
                    : (session.coOrganizerUids || []).includes(me || "")
                    ? "Co-organizer"
                    : "Participant"}
                </span>
              )}
            </div>
          </div>
          <div className="text-xs text-gray-500">
            {session.numCourts} court{session.numCourts > 1 ? "s" : ""}
            {(() => {
              const singles = (session.courts || []).filter(
                (c) => (c.mode || "doubles") === "singles"
              ).length;
              const doubles = (session.courts || []).filter(
                (c) => (c.mode || "doubles") === "doubles"
              ).length;
              const parts: string[] = [];
              if (doubles) parts.push(`${doubles} doubles`);
              if (singles) parts.push(`${singles} singles`);
              return parts.length ? ` · ${parts.join(", ")}` : "";
            })()}
            · {session.players.length} player
            {session.players.length !== 1 ? "s" : ""}
          </div>
          {session.ended && (
            <div className="mt-1 text-[11px] text-emerald-700">
              Ended
              {session.endedAt
                ? ` · ${new Date(session.endedAt).toLocaleString()}`
                : ""}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpen(session.id)}
            className="rounded-xl border border-gray-300 px-3 py-1.5"
          >
            Open
          </button>
          {rightActions}
        </div>
      </div>
    </Card>
  );
}
