"use client";

import Link from "next/link";
import FaqContent from "@/components/FaqContent";

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 text-sm">
      <h1 className="text-2xl font-semibold">FAQ</h1>
      <p className="mt-1 text-gray-600">Answers to common questions.</p>

      <div className="mt-6">
        <FaqContent />
      </div>

      <div className="mt-8">
        <Link href="/" className="rounded border px-3 py-1.5 text-xs">
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
