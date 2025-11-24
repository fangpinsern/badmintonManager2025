import {
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { isTelegramInAppBrowser } from "@/lib/ua";
import { detectPlatform } from "@/lib/notifications";

/**
 * Attempts Google sign-in via popup, with automatic fallback to redirect for
 * environments where popups or session/partitioned storage are blocked.
 */
export async function signInWithGoogleSafe(auth: Auth): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (isTelegramInAppBrowser()) {
    await signInWithRedirect(auth, provider);
    return;
  }

  try {
    await signInWithPopup(auth, provider);
    return;
  } catch (err: any) {
    const code: string = err?.code || "";
    const msg: string = (err?.message || "").toLowerCase();

    const shouldFallback =
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment" ||
      code === "auth/cancelled-popup-request" ||
      code === "auth/popup-closed-by-user" ||
      // Storage/session partitioning or missing initial state
      msg.includes("missing initial state") ||
      msg.includes("storage") ||
      msg.includes("partition") ||
      msg.includes("session");

    if (shouldFallback) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}
