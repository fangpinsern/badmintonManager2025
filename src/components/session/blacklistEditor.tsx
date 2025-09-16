"use client";
import { Session } from "@/types/player";
import { useStore } from "@/lib/store";
import { FormEvent, useState } from "react";
import { Select } from "@/components/layout";

function BlacklistEditor({ session }: { session: Session }) {
  const addPair = useStore((s) => s.addBlacklistPair);
  const removePair = useStore((s) => s.removeBlacklistPair);
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const pairs = session.autoAssignBlacklist?.pairs || [];
  const players = session.players;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!a || !b || a === b) return;
    addPair(session.id, a, b);
    setA("");
    setB("");
  };
  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select value={a} onChange={setA}>
          <option value="">Select player A</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={b} onChange={setB}>
          <option value="">Select player B</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <button
          type="submit"
          className="rounded-xl bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={!a || !b || a === b}
        >
          Add blacklist
        </button>
      </form>
      {pairs.length === 0 ? (
        <div className="text-xs text-gray-500">No blacklisted pairs.</div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {pairs.map((p, i) => {
            const na = players.find((x) => x.id === p.a)?.name || "(deleted)";
            const nb = players.find((x) => x.id === p.b)?.name || "(deleted)";
            return (
              <li
                key={`${p.a}-${p.b}-${i}`}
                className="flex items-center justify-between px-2 py-1.5 text-sm"
              >
                <div className="truncate">
                  {na} × {nb}
                </div>
                <button
                  onClick={() => removePair(session.id, p.a, p.b)}
                  className="rounded border px-2 py-0.5 text-xs"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="text-[11px] text-gray-500">
        Blacklisted pairs will be strongly avoided in doubles auto-assign.
      </div>
    </div>
  );
}

export { BlacklistEditor };
