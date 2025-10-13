"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, Input } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  subscribeClub,
  subscribeClubNotifications,
  updateClubTelegramSettingsRemote,
  issueClubTelegramLinkTokenRemote,
  type FirestoreClub,
} from "@/lib/firestoreClubs";

export default function ClubNotificationsSettingsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [club, setClub] = useState<FirestoreClub | null>(null);
  const [clubReady, setClubReady] = useState(false);
  const [noti, setNoti] = useState<{ telegram?: any } | null>(null);
  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(
    auth.currentUser
      ? { uid: auth.currentUser.uid, displayName: auth.currentUser.displayName }
      : null
  );
  const [authReady, setAuthReady] = useState(false);
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u ? { uid: u.uid, displayName: u.displayName } : null);
        setAuthReady(true);
      }),
    []
  );

  useEffect(() => {
    if (!id) return;
    setClubReady(false);
    const unsubClub = subscribeClub(
      id,
      (doc) => {
        setClub(doc as any);
        setClubReady(true);
      },
      () => setClubReady(true),
      user?.uid || undefined
    );
    const unsubNoti = subscribeClubNotifications(id, (n) => setNoti(n));
    return () => {
      try {
        unsubClub && (unsubClub as any)();
      } catch {}
      try {
        unsubNoti && (unsubNoti as any)();
      } catch {}
    };
  }, [id, user]);

  const isOwner = useMemo(
    () => !!club && !!user && club.ownerUid === user.uid,
    [club, user]
  );

  const telegram = (noti as any)?.telegram || {};
  const isLinked = String(telegram?.linkState || "unlinked") === "linked";
  const [enabled, setEnabled] = useState<boolean>(telegram?.enabled ?? false);
  const [sessionCreated, setSessionCreated] = useState<boolean>(
    telegram?.notifications?.sessionCreated?.enabled ?? false
  );
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(
    telegram?.notifications?.reminders?.enabled ?? false
  );
  const [monthlyEnabled, setMonthlyEnabled] = useState<boolean>(
    telegram?.notifications?.monthlySummary?.enabled ?? false
  );
  const [monthDay, setMonthDay] = useState<string>(
    String(telegram?.notifications?.monthlySummary?.dayOfMonth ?? 1)
  );
  const [monthHour, setMonthHour] = useState<string>(
    String(telegram?.notifications?.monthlySummary?.hour ?? 9)
  );
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [baseline, setBaseline] = useState<{
    enabled: boolean;
    sessionCreated: boolean;
    remindersEnabled: boolean;
    monthlyEnabled: boolean;
    monthDay: number;
    monthHour: number;
  }>({
    enabled: false,
    sessionCreated: false,
    remindersEnabled: false,
    monthlyEnabled: false,
    monthDay: 1,
    monthHour: 9,
  });

  useEffect(() => {
    // sync local state when club doc changes
    const t = (noti as any)?.telegram || {};
    setEnabled(t?.enabled ?? false);
    setSessionCreated(t?.notifications?.sessionCreated?.enabled ?? false);
    setRemindersEnabled(t?.notifications?.reminders?.enabled ?? false);
    setMonthlyEnabled(t?.notifications?.monthlySummary?.enabled ?? false);
    setMonthDay(String(t?.notifications?.monthlySummary?.dayOfMonth ?? 1));
    setMonthHour(String(t?.notifications?.monthlySummary?.hour ?? 9));
    setBaseline({
      enabled: t?.enabled ?? false,
      sessionCreated: t?.notifications?.sessionCreated?.enabled ?? false,
      remindersEnabled: t?.notifications?.reminders?.enabled ?? false,
      monthlyEnabled: t?.notifications?.monthlySummary?.enabled ?? false,
      monthDay: Number(
        String(t?.notifications?.monthlySummary?.dayOfMonth ?? 1)
      ),
      monthHour: Number(String(t?.notifications?.monthlySummary?.hour ?? 9)),
    });
    setSaved(false);
  }, [club?.id, (noti as any)?.telegram]);

  const dayNum = Math.floor(Number(monthDay));
  const hourNum = Math.floor(Number(monthHour));
  const dayValid = Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 28;
  const hourValid = Number.isFinite(hourNum) && hourNum >= 0 && hourNum <= 23;
  const isValid = dayValid && hourValid;
  const isDirty =
    enabled !== baseline.enabled ||
    sessionCreated !== baseline.sessionCreated ||
    remindersEnabled !== baseline.remindersEnabled ||
    monthlyEnabled !== baseline.monthlyEnabled ||
    dayNum !== baseline.monthDay ||
    hourNum !== baseline.monthHour;

  async function saveSettings() {
    if (!id || !user || !isOwner) return;
    if (!isValid) return;
    setSaving(true);
    try {
      await updateClubTelegramSettingsRemote(id, user.uid, {
        enabled,
        notifications: {
          sessionCreated: { enabled: sessionCreated },
          reminders: { enabled: remindersEnabled },
          monthlySummary: {
            enabled: monthlyEnabled,
            dayOfMonth: dayNum,
            hour: hourNum,
          },
        },
      });
      setBaseline({
        enabled,
        sessionCreated,
        remindersEnabled,
        monthlyEnabled,
        monthDay: dayNum,
        monthHour: hourNum,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function setupTelegram() {
    if (!id || !user || !isOwner) return;
    setLinking(true);
    try {
      const { token } = await issueClubTelegramLinkTokenRemote(id, user.uid);
      const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "";
      const link = botUsername
        ? `https://t.me/${botUsername}?startgroup=${token}`
        : `https://t.me/${token}`;
      window.open(link, "_blank", "noopener,noreferrer");
    } finally {
      setLinking(false);
    }
  }

  async function sendTestMessage() {
    if (!id || !user || !isOwner) return;
    if (!isLinked) return;
    setTesting(true);
    try {
      const endpoint = process.env.NEXT_PUBLIC_WORKER_BASE_URL
        ? `${process.env.NEXT_PUBLIC_WORKER_BASE_URL}/telegram/send`
        : "/api/telegram/send";
      await fetch(`${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clubId: id, type: "test" }),
      });
    } catch (e) {
    } finally {
      setTesting(false);
    }
  }

  if (!clubReady || !authReady) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <LoadingScreen />
        </Card>
      </main>
    );
  }

  if (!club) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="text-gray-600">Club not found.</div>
        </Card>
      </main>
    );
  }

  const base = `/clubs/${id}`;

  // Owner guard: only owner can access notification settings
  if (!isOwner) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-gray-600">
              Only the owner can access settings.
            </div>
            <Link href={`${base}`} className="rounded border px-2 py-1 text-xs">
              Back to club
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md md:max-w-2xl p-4 text-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <div className="text-gray-600">{club.name}</div>
        </div>
        <Link
          href={`${base}/settings`}
          className="rounded border px-2 py-1 text-xs"
        >
          Back to settings
        </Link>
      </header>

      <section className="mb-4">
        <Card>
          <div className="space-y-4">
            <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Telegram
            </div>
            {!isLinked && (
              <div className="space-y-2">
                <div className="text-sm">
                  Connect your club&apos;s Telegram group to enable
                  notifications.
                </div>
                <div className="text-[11px] text-gray-600">
                  You&apos;ll be able to configure delivery options once the bot
                  is linked to your group.
                </div>
                <div className="pt-1">
                  <button
                    className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                    disabled={!isOwner || linking}
                    onClick={setupTelegram}
                  >
                    {linking ? "Preparing..." : "Set up Telegram"}
                  </button>
                </div>
              </div>
            )}
            {isLinked && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Telegram delivery</div>
                    <div className="text-[11px] text-gray-600">
                      Master switch to enable/disable all Telegram notifications
                    </div>
                  </div>
                  <button
                    className={`rounded-full border px-3 py-1 text-xs ${
                      enabled ? "bg-blue-600 text-white" : ""
                    }`}
                    disabled={!isOwner}
                    onClick={() => setEnabled((v) => !v)}
                  >
                    {enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>

                <div className="border-t pt-4">
                  <div className="mb-2 font-medium">Event notifications</div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Session created</div>
                        <div className="text-[11px] text-gray-600">
                          Send a message when a new session is created
                        </div>
                      </div>
                      <button
                        className={`rounded-full border px-3 py-1 text-xs ${
                          sessionCreated ? "bg-blue-600 text-white" : ""
                        }`}
                        disabled={!isOwner}
                        onClick={() => setSessionCreated((v) => !v)}
                      >
                        {sessionCreated ? "On" : "Off"}
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Reminders</div>
                        <div className="text-[11px] text-gray-600">
                          Time-based reminders before a session starts
                        </div>
                      </div>
                      <button
                        className={`rounded-full border px-3 py-1 text-xs ${
                          remindersEnabled ? "bg-blue-600 text-white" : ""
                        }`}
                        disabled={!isOwner}
                        onClick={() => setRemindersEnabled((v) => !v)}
                      >
                        {remindersEnabled ? "On" : "Off"}
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Monthly summary</div>
                        <div className="text-[11px] text-gray-600">
                          Post a monthly stats summary to the group
                        </div>
                      </div>
                      <button
                        className={`rounded-full border px-3 py-1 text-xs ${
                          monthlyEnabled ? "bg-blue-600 text-white" : ""
                        }`}
                        disabled={!isOwner}
                        onClick={() => setMonthlyEnabled((v) => !v)}
                      >
                        {monthlyEnabled ? "On" : "Off"}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Input
                          type="number"
                          label="Day of month"
                          min={1}
                          max={28}
                          inputMode="numeric"
                          value={monthDay}
                          onChange={(e) => setMonthDay(e.target.value)}
                        />
                        {!dayValid && (
                          <div className="mt-1 text-[11px] text-red-600">
                            Enter a value between 1 and 28.
                          </div>
                        )}
                      </div>
                      <div>
                        <Input
                          type="number"
                          label="Hour (0-23)"
                          min={0}
                          max={23}
                          inputMode="numeric"
                          value={monthHour}
                          onChange={(e) => setMonthHour(e.target.value)}
                        />
                        {!hourValid && (
                          <div className="mt-1 text-[11px] text-red-600">
                            Enter a value between 0 and 23.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="mb-2 font-medium">Connection</div>
                  <div className="text-[11px] text-gray-600">
                    Link your Telegram bot to a group via the Settings page.
                    Linking flow will be added next.
                  </div>
                  <div className="mt-2 text-[11px] text-gray-500">
                    Status: {(telegram?.linkState || "unlinked").toUpperCase()}
                  </div>
                  <div className="mt-2">
                    <button
                      className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                      disabled={!isOwner || testing}
                      onClick={sendTestMessage}
                    >
                      {testing ? "Sending..." : "Send test message"}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {saved && (
                    <div className="mr-auto rounded border border-green-200 bg-green-50 px-2 py-1 text-[11px] text-green-700">
                      Saved
                    </div>
                  )}
                  <Link
                    href={`${base}/settings`}
                    className="rounded-xl border px-3 py-1.5 text-sm"
                  >
                    Cancel
                  </Link>
                  <button
                    className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    disabled={!isOwner || saving || !isDirty || !isValid}
                    onClick={saveSettings}
                  >
                    Save
                  </button>
                </div>
              </>
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}

export const runtime = "edge";
