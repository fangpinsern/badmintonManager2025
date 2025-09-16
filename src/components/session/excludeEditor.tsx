"use client";
import { Session } from "@/types/player";
import { useStore } from "@/lib/store";
import { FormEvent, useState } from "react";
import { Select } from "@/components/layout";

function ExcludeEditor({ session }: { session: Session }) {
  const [sel, setSel] = useState<string>("");
  const players = session.players;
  const current = new Set(session.autoAssignExclude || []);
  const update = (ids: string[]) => {
    useStore.setState((state) => ({
      sessions: state.sessions.map((ss) =>
        ss.id === session.id ? { ...ss, autoAssignExclude: ids } : ss
      ),
    }));
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!sel) return;
    if (current.has(sel)) return;
    update([...(session.autoAssignExclude || []), sel]);
    setSel("");
  };
  const remove = (id: string) => {
    update((session.autoAssignExclude || []).filter((x) => x !== id));
  };
  return (
    <div className="space-y-2">
      <form onSubmit={add} className="flex items-center gap-2">
        <Select value={sel} onChange={setSel}>
          <option value="">Select player</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <button
          type="submit"
          className="rounded-xl bg-black px-3 py-1.5 text-xs text-white"
        >
          Exclude
        </button>
      </form>
      {current.size === 0 ? (
        <div className="text-xs text-gray-500">No excluded players.</div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {Array.from(current).map((id) => {
            const n = players.find((p) => p.id === id)?.name || "(deleted)";
            return (
              <li
                key={id}
                className="flex items-center justify-between px-2 py-1.5 text-sm"
              >
                <div className="truncate">{n}</div>
                <button
                  onClick={() => remove(id)}
                  className="rounded border px-2 py-0.5 text-xs"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export { ExcludeEditor };
