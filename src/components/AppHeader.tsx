"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

export default function AppHeader() {
  const [hasUser, setHasUser] = useState(!!auth.currentUser);
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setHasUser(!!u));
  }, []);
  const isTest =
    String(process.env.NEXT_PUBLIC_TEST_MODE || "").toLowerCase() === "true" ||
    process.env.NEXT_PUBLIC_TEST_MODE === "1";

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-3xl p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Link href="/" className="text-2xl font-bold">
                🏸 Badminton Manager
              </Link>
              {isTest && (
                <span className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700">
                  BETA
                </span>
              )}
            </div>
            <p className="text-gray-500">
              Create sessions, add players, assign courts.
            </p>
          </div>
          {hasUser ? (
            <Link
              href="/profile"
              aria-label="Go to profile"
              className="ml-4 rounded-full border p-2 text-gray-600 hover:bg-gray-100"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-8 w-8"
              >
                <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z" />
                <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
              </svg>
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
