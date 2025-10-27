"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { deployedAtIso } from "@/buildInfo";

type ChangelogPayload = {
  branch: string;
  repository?: string;
  generatedAtIso: string;
  commits: Array<{
    commitFull: string;
    commit: string;
    author: string;
    dateIso: string;
    message: string;
    title?: string;
    body?: string;
  }>;
};

export default function ChangelogPage() {
  const [payload, setPayload] = useState<ChangelogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20; // pagination size
  const maxCommits = 500; // hard truncation cap for very large histories

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/changelog.json", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load changelog");
        const json = (await res.json()) as ChangelogPayload;
        if (!cancelled) setPayload(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load changelog");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commits = useMemo(() => {
    const arr = payload?.commits || [];
    // truncate to prevent rendering too many nodes
    return arr.slice(0, maxCommits);
  }, [payload]);

  const totalPages = Math.max(1, Math.ceil(commits.length / pageSize));
  const pageCommits = commits.slice((page - 1) * pageSize, page * pageSize);

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Changelog</h1>
        <p className="text-gray-500">What changed in each deployment.</p>
      </div>

      <div className="flex items-center gap-2 mb-6 text-xs text-gray-500">
        <span className="rounded-full border px-2 py-0.5">
          Branch: {payload?.branch || "unknown"}
        </span>
        <span>Generated: {payload?.generatedAtIso || deployedAtIso}</span>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <ol className="relative border-s">
        {pageCommits.map((c, idx) => (
          <li key={c.commitFull} className="ms-6 pb-8 last:pb-0">
            <span className="absolute -start-1.5 mt-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-blue-100 ring-8 ring-white" />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <time className="text-sm text-gray-500">
                {new Date(c.dateIso).toLocaleString()}
              </time>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                {payload?.branch || "branch"}
              </span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                {c.commit}
              </span>
              <span className="text-[11px] text-gray-500">by {c.author}</span>
            </div>
            <div className="mt-2 text-sm leading-6 text-gray-800">
              <div className="font-medium">{c.title || c.message}</div>
              {(() => {
                const body = (c as any).body as string | undefined;
                if (!body) return null;
                return (
                  <pre className="whitespace-pre-wrap break-words text-gray-700 mt-1 text-[13px]">
                    {body}
                  </pre>
                );
              })()}
            </div>
            <div className="mt-3 flex gap-2 text-xs">
              <Link
                className="rounded-full border px-3 py-1 text-gray-700 hover:bg-gray-100"
                href={
                  payload?.repository
                    ? `https://github.com/${payload.repository}/commit/${c.commitFull}`
                    : `https://github.com/commit/${c.commitFull}`
                }
                target="_blank"
              >
                View commit
              </Link>
              <Link
                className="rounded-full border px-3 py-1 text-gray-700 hover:bg-gray-100"
                href={
                  payload?.repository
                    ? `https://github.com/${payload.repository}/tree/${
                        payload.branch || "main"
                      }`
                    : `https://github.com/tree/${payload?.branch || "main"}`
                }
                target="_blank"
              >
                View branch
              </Link>
            </div>
            {idx < pageCommits.length - 1 && (
              <div className="mt-6 h-px w-full bg-gray-100" />
            )}
          </li>
        ))}
      </ol>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between text-xs">
          <button
            className="rounded-full border px-3 py-1 text-gray-700 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <div className="text-gray-600">
            Page {page} / {totalPages}
          </div>
          <button
            className="rounded-full border px-3 py-1 text-gray-700 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}

      <div className="mt-10 text-xs text-gray-500">
        <p>Showing up to {maxCommits} most recent commits.</p>
      </div>
    </main>
  );
}
