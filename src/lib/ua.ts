"use client";

/**
 * Detects if the app is running inside Telegram's in-app browser.
 * Uses both the user agent and the Telegram WebApp global if present.
 */
export function isTelegramInAppBrowser(): boolean {
  try {
    // Telegram WebApp JS object presence
    const hasTelegramWebApp =
      typeof window !== "undefined" &&
      (!!(window as any)?.Telegram?.WebApp ||
        typeof (window as any).TelegramWebview !== "undefined" ||
        (window as any).TelegramWebviewProxy !== "undefined");
    // User agent check
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    const hasTelegramUA = /Telegram/i.test(ua);
    return hasTelegramWebApp || hasTelegramUA;
  } catch {
    return false;
  }
}
