"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { deployedAtIso } from "@/buildInfo";

export default function AppFooter() {
  const [hasUser, setHasUser] = useState(!!auth.currentUser);
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setHasUser(!!u));
  }, []);
  return (
    <footer className="my-6 text-center text-xs text-gray-400">
      <div className="mx-4 flex items-center justify-center gap-3">
        <a
          href={
            (process.env.NEXT_PUBLIC_TELEGRAM_URL as string) ||
            "https://t.me/bm25r"
          }
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border px-2 py-1 text-xs"
        >
          Subscribe for Updates
        </a>
        <Link href="/faq" className="rounded border px-2 py-1 text-xs">
          FAQ
        </Link>
        <Link href="/changelog" className="rounded border px-2 py-1 text-xs">
          Changelog
        </Link>
        {hasUser ? (
          <>
            <button
              onClick={() => signOut(auth)}
              className="rounded border px-2 py-1 text-xs"
            >
              Sign out
            </button>
          </>
        ) : null}
      </div>
      <div className="mt-2">
        {(() => {
          try {
            const d = new Date(deployedAtIso);
            if (!isNaN(d.getTime())) {
              return <span>Last deployed: {d.toLocaleString()}</span>;
            }
          } catch {}
          return null;
        })()}
      </div>
    </footer>
  );
}
