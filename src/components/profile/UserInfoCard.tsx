"use client";
import React from "react";

export default function UserInfoCard({
  username,
  racketModels,
  favouriteShuttlecock,
  bio,
  level,
}: {
  username?: string | null;
  racketModels?: string[] | null;
  favouriteShuttlecock?: string | null;
  bio?: string | null;
  level?: string | null;
}) {
  const hasRackets = Array.isArray(racketModels) && racketModels.length > 0;
  const hasFav = !!(favouriteShuttlecock && favouriteShuttlecock.trim());
  const hasBio = !!(bio && bio.trim());
  const hasLevel = !!(level && level.trim());
  const hasUsername = !!(username && username.trim());

  if (!hasUsername && !hasRackets && !hasFav && !hasBio && !hasLevel) {
    return null;
  }

  const truncatedBio = hasBio ? (bio as string).slice(0, 200) : "";

  return (
    <div className="space-y-3">
      {hasUsername && (
        <div>
          <div className="text-[11px] text-gray-500">Username</div>
          <div className="mt-0.5 text-base font-medium text-gray-900">
            {username}
          </div>
        </div>
      )}
      {hasRackets && (
        <div>
          <div className="text-[11px] text-gray-500">Racket models</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(racketModels as string[]).map((m) => (
              <span
                key={m}
                className="inline-block rounded-full border bg-white px-2 py-0.5 text-[11px] text-gray-700"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
      {hasFav && (
        <div>
          <div className="text-[11px] text-gray-500">Favourite shuttlecock</div>
          <div className="mt-0.5 text-sm text-gray-900">
            {favouriteShuttlecock}
          </div>
        </div>
      )}
      {hasBio && (
        <div>
          <div className="text-[11px] text-gray-500">Short bio</div>
          <div className="mt-0.5 whitespace-pre-wrap text-sm text-gray-900">
            {truncatedBio}
          </div>
        </div>
      )}
      {hasLevel && (
        <div>
          <div className="text-[11px] text-gray-500">Self-assessed level</div>
          <div className="mt-0.5 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            {level}
          </div>
        </div>
      )}
    </div>
  );
}
