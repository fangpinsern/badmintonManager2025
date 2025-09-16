"use client";

import { useStore } from "@/lib/store";

function AddCourtButton({ sessionId }: { sessionId: string }) {
  const addCourt = useStore((s) => s.addCourt);
  return (
    <button
      onClick={() => addCourt(sessionId)}
      className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
    >
      + Add court
    </button>
  );
}

export { AddCourtButton };
