"use client";

import React, { useEffect, useRef } from "react";

declare global {
  interface Window {
    katex?: {
      render: (tex: string, el: Element, opts?: any) => void;
    };
  }
}

function ensureKatexLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.katex) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    try {
      // Inject KaTeX CSS once
      const cssId = "katex-css";
      if (!document.getElementById(cssId)) {
        const link = document.createElement("link");
        link.id = cssId;
        link.rel = "stylesheet";
        link.href =
          "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
      }
      // Inject KaTeX JS once
      const jsId = "katex-js";
      const existing = document.getElementById(
        jsId
      ) as HTMLScriptElement | null;
      if (existing && (window as any).katex) {
        resolve();
        return;
      }
      if (existing && !window.katex) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("KaTeX failed to load")),
          { once: true }
        );
        return;
      }
      const script = document.createElement("script");
      script.id = jsId;
      script.defer = true;
      script.src =
        "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";
      script.crossOrigin = "anonymous";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("KaTeX failed to load"));
      document.head.appendChild(script);
    } catch (e) {
      reject(e as any);
    }
  });
}

export default function MathBlock({
  latex,
  displayMode = true,
  className = "",
}: {
  latex: string;
  displayMode?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        await ensureKatexLoaded();
        if (cancelled) return;
        const el = ref.current;
        if (!el || !window.katex) return;
        window.katex.render(latex, el, {
          displayMode,
          throwOnError: false,
          strict: "ignore",
          trust: false,
        });
      } catch {
        // ignore
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [latex, displayMode]);

  return (
    <div
      ref={ref}
      className={`max-w-full overflow-x-auto ${className}`}
      aria-hidden="true"
    />
  );
}
