"use client";

import { useStore } from "@/lib/store";
import { useMemo } from "react";

function AddCourtButton({ sessionId }: { sessionId: string }) {
  const addCourt = useStore((s) => s.addCourt);
  const sessions = useStore((s) => s.sessions);
  const count = useMemo(() => {
    const ss = sessions.find((s) => s.id === sessionId);
    return ss ? ss.courts?.length || 0 : 0;
  }, [sessions, sessionId]);
  return (
    <button
      onClick={() => {
        if (count >= 10) {
          alert("Courts per session are limited to 10.");
          return;
        }
        addCourt(sessionId);
      }}
      disabled={count >= 10}
      className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
    >
      {count >= 10 ? "Max 10 courts" : "+ Add court"}
    </button>
  );
}

export { AddCourtButton };
