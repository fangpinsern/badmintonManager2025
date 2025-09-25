import { db } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { nanoid } from "nanoid";

function getOrCreateDeviceId(): string {
  try {
    const key = "device_id";
    const existing = localStorage.getItem(key);
    if (existing && existing.length > 0) return existing;
    const id = nanoid(21);
    localStorage.setItem(key, id);
    return id;
  } catch {
    return nanoid(21);
  }
}

function detectInstalledPwa(): boolean {
  try {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
      (window as any).navigator?.standalone === true;
    return !!standalone;
  } catch {
    return false;
  }
}

function detectPlatform(): "ios" | "android" | "desktop" {
  try {
    const ua = (navigator.userAgent || "").toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (/android/.test(ua)) return "android";
    return "desktop";
  } catch {
    return "desktop";
  }
}

async function saveDeviceTokenDoc(
  uid: string,
  token: string,
  platform: "ios" | "android" | "desktop",
  installedPwa: boolean
) {
  const deviceId = getOrCreateDeviceId();
  const ref = doc(db, "usersNoti_test", uid, "devices", deviceId);
  await setDoc(
    ref,
    {
      token,
      platform,
      installedPwa,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export {
  getOrCreateDeviceId,
  detectInstalledPwa,
  detectPlatform,
  saveDeviceTokenDoc,
};
