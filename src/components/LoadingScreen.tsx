"use client";
import React from "react";

type SkeletonBox = {
  width?: string;
  height?: string;
  className?: string;
};

type LoadingScreenProps = {
  message?: string;
  /**
   * Rendering style. Defaults to "spinner" to preserve existing behavior.
   */
  variant?: "spinner" | "skeleton";
  /**
   * When using skeletons, you can fully customize the boxes.
   * If omitted, a reasonable list-like skeleton will be shown.
   */
  boxes?: SkeletonBox[];
  /**
   * When boxes are not provided, how many list-like skeleton items to render.
   */
  count?: number;
  /**
   * Optional container class override.
   */
  className?: string;
};

export function LoadingScreen({
  message,
  variant = "spinner",
  boxes,
  count = 3,
  className,
}: LoadingScreenProps) {
  if (variant === "skeleton") {
    // Default list-like skeletons if no custom boxes are provided
    const renderDefaultList = () => (
      <div className="space-y-3">
        {Array.from({ length: Math.max(1, count) }).map((_, idx) => (
          <div key={idx} className="animate-pulse">
            <div className="h-4 w-1/2 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-1/3 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );

    const renderCustomBoxes = () => (
      <div className="space-y-3 animate-pulse">
        {(boxes || []).map((b, i) => (
          <div
            key={i}
            className={`rounded bg-gray-200 ${b?.className || ""}`}
            style={{
              height: b?.height || "1rem",
              width: b?.width || "100%",
            }}
          />
        ))}
      </div>
    );

    return (
      <div className={className || "p-2"}>
        {boxes && boxes.length > 0 ? renderCustomBoxes() : renderDefaultList()}
      </div>
    );
  }

  // Spinner variant (default) to preserve existing behavior
  return (
    <div
      className={className || "flex min-h-[50vh] items-center justify-center"}
    >
      <div className="flex items-center gap-3 text-gray-600">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
        <span className="text-sm">{message || "Loading…"}</span>
      </div>
    </div>
  );
}

export default LoadingScreen;
