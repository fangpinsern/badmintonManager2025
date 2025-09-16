"use client";
import React from "react";

export function LoadingScreen({ message }: { message?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex items-center gap-3 text-gray-600">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
        <span className="text-sm">{message || "Loading…"}</span>
      </div>
    </div>
  );
}

export default LoadingScreen;
