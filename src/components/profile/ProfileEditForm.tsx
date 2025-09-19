"use client";
import React, { useMemo, useState } from "react";

export type ProfileEditable = {
  racketModels?: string[] | null;
  favouriteShuttlecock?: string | null;
  bio?: string | null;
  level?: string | null;
};

export default function ProfileEditForm({
  value,
  onChange,
  onSubmit,
  saving,
}: {
  value: ProfileEditable;
  onChange: (v: ProfileEditable) => void;
  onSubmit: () => Promise<void> | void;
  saving?: boolean;
}) {
  const [newModel, setNewModel] = useState("");

  const models = useMemo(() => value.racketModels || [], [value.racketModels]);
  const disabled = !!saving;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-gray-500">Racket models</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {models.map((m) => (
            <span
              key={m}
              className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[11px] text-gray-700"
            >
              {m}
              <button
                type="button"
                className="text-gray-500 hover:text-gray-700"
                onClick={() =>
                  onChange({
                    ...value,
                    racketModels: models.filter((x) => x !== m),
                  })
                }
                disabled={disabled}
                aria-label={`Remove ${m}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="Add racket model"
            className="w-full rounded border px-2 py-1 text-sm"
            disabled={disabled}
          />
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            disabled={disabled || !newModel.trim()}
            onClick={() => {
              const next = newModel.trim();
              if (!next) return;
              const nextList = Array.from(
                new Set([...(models || []), next])
              ).slice(0, 10);
              onChange({ ...value, racketModels: nextList });
              setNewModel("");
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500">Favourite shuttlecock</label>
        <input
          type="text"
          value={value.favouriteShuttlecock || ""}
          onChange={(e) =>
            onChange({ ...value, favouriteShuttlecock: e.target.value })
          }
          placeholder="e.g. Yonex AS50"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          disabled={disabled}
        />
      </div>

      <div>
        <label className="text-xs text-gray-500">
          Short bio (max 200 chars)
        </label>
        <textarea
          value={value.bio || ""}
          onChange={(e) =>
            onChange({ ...value, bio: e.target.value.slice(0, 200) })
          }
          placeholder="Tell others a little about you"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          rows={3}
          maxLength={200}
          disabled={disabled}
        />
        <div className="mt-0.5 text-[11px] text-gray-500">
          {(value.bio || "").length}/200
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500">Self-assessed level</label>
        <select
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={value.level || ""}
          onChange={(e) =>
            onChange({ ...value, level: e.target.value || null })
          }
          disabled={disabled}
        >
          <option value="">Select level</option>
          <option>Beginner</option>
          <option>Lower Intermediate</option>
          <option>Intermediate</option>
          <option>Intermediate+</option>
          <option>Advanced</option>
        </select>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onSubmit}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          disabled={disabled}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
