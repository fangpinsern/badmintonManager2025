import { Card } from "@/components/layout";
import Link from "next/link";
import React from "react";

type Ladder =
  | {
      R?: number;
      K?: number;
      matches?: number;
    }
  | null
  | undefined;

export default function RatingsCard({
  singles,
  doubles,
  version,
  updatedAt,
  isSelf = false,
  className = "",
}: {
  singles?: Ladder;
  doubles?: Ladder;
  version?: string | null;
  updatedAt?: string | null;
  isSelf?: boolean;
  className?: string;
}) {
  const fmt = (n?: number) => {
    const v = Number.isFinite(n as number) ? Math.round(Number(n)) : 1500;
    return v.toString();
  };
  const prov = (matches?: number) => Number(matches || 0) < 10;

  const hasSingles =
    !!singles &&
    (Number.isFinite((singles as any).R) ||
      typeof (singles as any).matches === "number");
  const hasDoubles =
    !!doubles &&
    (Number.isFinite((doubles as any).R) ||
      typeof (doubles as any).matches === "number");

  const sR = hasSingles ? fmt(singles?.R) : null;
  const dR = hasDoubles ? fmt(doubles?.R) : null;
  const sM = hasSingles ? Number(singles?.matches || 0) : null;
  const dM = hasDoubles ? Number(doubles?.matches || 0) : null;
  const sProv = hasSingles ? prov(singles?.matches) : null;
  const dProv = hasDoubles ? prov(doubles?.matches) : null;
  const hasAny = hasSingles || hasDoubles;

  const updated =
    typeof updatedAt === "string" && updatedAt
      ? new Date(updatedAt).toLocaleDateString()
      : null;

  return (
    <Card className={className}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Ratings</h2>
        <Link
          href="/faq"
          className="text-[11px] text-gray-600 underline underline-offset-2"
        >
          How this works
        </Link>
      </div>

      {!hasAny ? (
        <div className="mt-3 rounded-lg border bg-gray-50 p-4 text-sm text-gray-700">
          <div className="font-medium">
            {isSelf
              ? "You are not rated yet."
              : "This player is not rated yet."}
          </div>
          {isSelf && (
            <div className="mt-1 text-[12px] text-gray-600">
              Join a session and play. Your rating updates automatically when
              the organizer ends the session.
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="text-[11px] text-gray-600">Doubles</div>
            {hasDoubles ? (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <div className="text-2xl font-bold">{dR}</div>
                  {dProv !== null && (
                    <Badge
                      label={dProv ? "Provisional" : "Established"}
                      tone={dProv ? "amber" : "green"}
                    />
                  )}
                </div>
                <div className="mt-1 text-[11px] text-gray-600">
                  Matches: {dM}
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-700">
                Unrated
              </div>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-[11px] text-gray-600">Singles</div>
            {hasSingles ? (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <div className="text-2xl font-bold">{sR}</div>
                  {sProv !== null && (
                    <Badge
                      label={sProv ? "Provisional" : "Established"}
                      tone={sProv ? "amber" : "green"}
                    />
                  )}
                </div>
                <div className="mt-1 text-[11px] text-gray-600">
                  Matches: {sM}
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm font-medium text-gray-700">
                Unrated
              </div>
            )}
          </div>
        </div>
      )}

      {hasAny && (
        <div className="mt-3 flex items-center justify-between text-[11px] text-gray-600">
          <div>
            {typeof version === "string" && version
              ? `Model v${version}`
              : "Model v0.1"}
          </div>
          {updated ? <div>Updated {updated}</div> : <div />}
        </div>
      )}
    </Card>
  );
}

function Badge({
  label,
  tone = "gray",
}: {
  label: string;
  tone?: "gray" | "green" | "amber";
}) {
  const cls =
    tone === "green"
      ? "bg-green-100 text-green-700 border-green-200"
      : tone === "amber"
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span
      className={`rounded border px-2 py-[2px] text-[10px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
