"use client";
import { app } from "./firebase";
import {
  getAnalytics,
  isSupported,
  logEvent as firebaseLogEvent,
  setUserId as firebaseSetUserId,
  setUserProperties as firebaseSetUserProperties,
  type Analytics,
} from "firebase/analytics";

let analyticsInstance: Analytics | null | undefined;

async function ensureAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined") return null;
  if (analyticsInstance !== undefined) return analyticsInstance || null;
  try {
    const supported = await isSupported();
    if (!supported) {
      analyticsInstance = null;
      return null;
    }
    analyticsInstance = getAnalytics(app);
    return analyticsInstance;
  } catch {
    analyticsInstance = null;
    return null;
  }
}

export async function getAnalyticsOrNull(): Promise<Analytics | null> {
  return ensureAnalytics();
}

export async function logAnalyticsEvent(
  eventName: string,
  params?: Record<string, unknown>
): Promise<void> {
  const inst = await ensureAnalytics();
  if (!inst) return;
  try {
    firebaseLogEvent(inst, eventName as any, params as any);
  } catch {}
}

export async function setAnalyticsUserId(userId: string | null): Promise<void> {
  const inst = await ensureAnalytics();
  if (!inst) return;
  try {
    firebaseSetUserId(inst, userId || null);
  } catch {}
}

export async function setAnalyticsUserProperties(
  props: Record<string, any>
): Promise<void> {
  const inst = await ensureAnalytics();
  if (!inst) return;
  try {
    firebaseSetUserProperties(inst, props);
  } catch {}
}
