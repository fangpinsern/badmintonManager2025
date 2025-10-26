"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { subscribeUserProfile } from "@/lib/firestoreSessions";

export default function UsernameEnforcer() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [authReady, setAuthReady] = useState<boolean>(!!auth.currentUser);
  const [userUid, setUserUid] = useState<string | null>(
    auth.currentUser?.uid || null
  );
  const [needsUsername, setNeedsUsername] = useState<boolean>(false);
  const [profileChecked, setProfileChecked] = useState<boolean>(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUserUid(u?.uid || null);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!userUid) {
      setNeedsUsername(false);
      setProfileChecked(true);
      return;
    }
    const unsub = subscribeUserProfile(userUid, (p) => {
      const has = p && typeof p.username === "string" && p.username.trim();
      setNeedsUsername(!has);
      setProfileChecked(true);
    });
    return () => {
      try {
        unsub();
      } catch {}
    };
  }, [userUid]);

  useEffect(() => {
    if (!authReady || !profileChecked) return;
    if (!userUid) return;
    // Avoid loops if already on auth page
    if ((pathname || "").startsWith("/auth")) return;
    if (needsUsername) {
      const qs = sp?.toString() || "";
      const current = `${pathname}${qs ? `?${qs}` : ""}`;
      try {
        router.replace(`/auth?returnTo=${encodeURIComponent(current)}`);
      } catch {}
    }
  }, [authReady, profileChecked, userUid, needsUsername, pathname, sp, router]);

  return null;
}
