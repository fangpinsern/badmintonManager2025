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
  type ClubReminder,
} from "@/lib/firestoreClubs";

const COMMON_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Tokyo",
  "Australia/Sydney",
];

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
  const [timeZone, setTimeZone] = useState<string>(telegram?.tz || "UTC");
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [copying, setCopying] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [sessionCreated, setSessionCreated] = useState<boolean>(
    telegram?.notifications?.sessionCreated?.enabled ?? false
  );
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(
    telegram?.notifications?.reminders?.enabled ?? false
  );
  const [monthlyEnabled, setMonthlyEnabled] = useState<boolean>(
    telegram?.notifications?.monthlySummary?.enabled ?? false
  );
  const [customRemindersEnabled, setCustomRemindersEnabled] = useState<boolean>(
    telegram?.notifications?.customReminders?.enabled ?? false
  );
  const [customReminders, setCustomReminders] = useState<ClubReminder[]>(
    Array.isArray(telegram?.notifications?.customReminders?.items)
      ? (telegram?.notifications?.customReminders?.items as ClubReminder[])
      : []
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
    timeZone: string;
    sessionCreated: boolean;
    remindersEnabled: boolean;
    customRemindersEnabled: boolean;
    customRemindersHash: string;
    monthlyEnabled: boolean;
    monthDay: number;
    monthHour: number;
  }>({
    enabled: false,
    timeZone: "UTC",
    sessionCreated: false,
    remindersEnabled: false,
    customRemindersEnabled: false,
    customRemindersHash: "",
    monthlyEnabled: false,
    monthDay: 1,
    monthHour: 9,
  });

  useEffect(() => {
    // sync local state when club doc changes
    const t = (noti as any)?.telegram || {};
    setEnabled(t?.enabled ?? false);
    setTimeZone(String(t?.tz || "UTC"));
    setSessionCreated(t?.notifications?.sessionCreated?.enabled ?? false);
    setRemindersEnabled(t?.notifications?.reminders?.enabled ?? false);
    setCustomRemindersEnabled(
      t?.notifications?.customReminders?.enabled ?? false
    );
    setCustomReminders(
      Array.isArray(t?.notifications?.customReminders?.items)
        ? (t?.notifications?.customReminders?.items as ClubReminder[])
        : []
    );
    setMonthlyEnabled(t?.notifications?.monthlySummary?.enabled ?? false);
    setMonthDay(String(t?.notifications?.monthlySummary?.dayOfMonth ?? 1));
    setMonthHour(String(t?.notifications?.monthlySummary?.hour ?? 9));
    const hash = hashReminders(
      Array.isArray(t?.notifications?.customReminders?.items)
        ? (t?.notifications?.customReminders?.items as ClubReminder[])
        : []
    );
    setBaseline({
      enabled: t?.enabled ?? false,
      timeZone: String(t?.tz || "UTC"),
      sessionCreated: t?.notifications?.sessionCreated?.enabled ?? false,
      remindersEnabled: t?.notifications?.reminders?.enabled ?? false,
      customRemindersEnabled:
        t?.notifications?.customReminders?.enabled ?? false,
      customRemindersHash: hash,
      monthlyEnabled: t?.notifications?.monthlySummary?.enabled ?? false,
      monthDay: Number(
        String(t?.notifications?.monthlySummary?.dayOfMonth ?? 1)
      ),
      monthHour: Number(String(t?.notifications?.monthlySummary?.hour ?? 9)),
    });
    setSaved(false);
  }, [club?.id, (noti as any)?.telegram]);

  // Tick timer to update link token countdown while a token exists
  useEffect(() => {
    const expiresAt = Number((telegram as any)?.linkTokenExpiresAt || 0);
    if (!expiresAt) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [telegram?.linkTokenExpiresAt]);

  const dayNum = Math.floor(Number(monthDay));
  const hourNum = Math.floor(Number(monthHour));
  const dayValid = Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 28;
  const hourValid = Number.isFinite(hourNum) && hourNum >= 0 && hourNum <= 23;
  const isValid = dayValid && hourValid;
  const remindersHash = hashReminders(customReminders);
  const isDirty =
    enabled !== baseline.enabled ||
    timeZone !== baseline.timeZone ||
    sessionCreated !== baseline.sessionCreated ||
    remindersEnabled !== baseline.remindersEnabled ||
    customRemindersEnabled !== baseline.customRemindersEnabled ||
    remindersHash !== baseline.customRemindersHash ||
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
        tz: timeZone,
        notifications: {
          sessionCreated: { enabled: sessionCreated },
          reminders: { enabled: remindersEnabled },
          customReminders: {
            enabled: customRemindersEnabled,
            items: customReminders.slice(0, 5),
          },
          monthlySummary: {
            enabled: monthlyEnabled,
            dayOfMonth: dayNum,
            hour: hourNum,
          },
        },
      });
      // Best-effort: tell worker to sync reminders configuration
      try {
        const endpoint = process.env.NEXT_PUBLIC_WORKER_BASE_URL
          ? `${process.env.NEXT_PUBLIC_WORKER_BASE_URL}/telegram/reminders/sync`
          : "/api/telegram/reminders/sync";
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clubId: id }),
        });
      } catch {}
      setBaseline({
        enabled,
        timeZone,
        sessionCreated,
        remindersEnabled,
        customRemindersEnabled,
        customRemindersHash: hashReminders(customReminders),
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

  function hashReminders(items: ClubReminder[]): string {
    try {
      const norm = [...(items || [])]
        .map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          message: String(r.message || ""),
          dow: Number(r.dow || 0),
          hour: Number(r.hour || 0),
          minute: Number(r.minute || 0),
          enabled: r.enabled !== false,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      return JSON.stringify(norm);
    } catch {
      return "";
    }
  }

  // Modal state for adding/editing a reminder
  const [remModalOpen, setRemModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [remName, setRemName] = useState("");
  const [remMsg, setRemMsg] = useState("");
  const [remDow, setRemDow] = useState<string>("1");
  const [remTime, setRemTime] = useState<string>("09:00");
  function resetRemModal() {
    setRemName("");
    setRemMsg("");
    setRemDow("1");
    setRemTime("09:00");
    setEditingId(null);
  }
  function openAddReminder() {
    resetRemModal();
    setRemModalOpen(true);
  }
  function openEditReminder(r: ClubReminder) {
    setEditingId(r.id);
    setRemName(r.name || "");
    setRemMsg(r.message || "");
    setRemDow(String(r.dow));
    const hh = String(Math.max(0, Math.min(23, Number(r.hour)))).padStart(
      2,
      "0"
    );
    const mm = String(Math.max(0, Math.min(59, Number(r.minute)))).padStart(
      2,
      "0"
    );
    setRemTime(`${hh}:${mm}`);
    setRemModalOpen(true);
  }
  function addReminderConfirm() {
    const [hh, mm] = String(remTime || "09:00").split(":");
    const hour = Math.max(0, Math.min(23, Number(hh)));
    const minute = Math.max(0, Math.min(59, Number(mm)));
    if (editingId) {
      setCustomReminders((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? {
                ...r,
                name: (remName || "").trim() || "Reminder",
                message: (remMsg || "").trim() || "Reminder",
                dow: Math.max(0, Math.min(6, Number(remDow))) as any,
                hour,
                minute,
              }
            : r
        )
      );
    } else {
      const item: ClubReminder = {
        id:
          (typeof crypto !== "undefined" && (crypto as any).randomUUID
            ? (crypto as any).randomUUID()
            : Math.random().toString(36).slice(2)) + Date.now().toString(36),
        name: (remName || "").trim() || "Reminder",
        message: (remMsg || "").trim() || "Reminder",
        dow: Math.max(0, Math.min(6, Number(remDow))) as any,
        hour,
        minute,
        enabled: true,
      };
      setCustomReminders(
        (prev) => [...prev, item].slice(0, 5) // enforce max 5
      );
    }
    setRemModalOpen(false);
  }

  function toggleReminder(id2: string) {
    setCustomReminders((prev) =>
      prev.map((r) =>
        r.id === id2 ? { ...r, enabled: r.enabled === false ? true : false } : r
      )
    );
  }
  function removeReminder(id2: string) {
    setCustomReminders((prev) => prev.filter((r) => r.id !== id2));
  }

  function dowName(d: number): string {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
      Math.max(0, Math.min(6, d))
    ];
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
              <div className="space-y-3">
                <div className="text-sm">
                  Connect your club&apos;s Telegram group to enable
                  notifications.
                </div>
                <div className="text-[11px] text-gray-600">
                  You&apos;ll be able to configure delivery options once the bot
                  is linked to your group.
                </div>

                <div className="rounded border p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase text-gray-500">
                    Step 1
                  </div>
                  <div className="text-sm">
                    Add the bot to your Telegram group
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                      disabled={!isOwner || linking}
                      onClick={setupTelegram}
                    >
                      {linking ? "Preparing..." : "Add via Telegram"}
                    </button>
                    {process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME && (
                      <div className="text-[11px] text-gray-600">
                        If the button doesn&apos;t work, open Telegram and add{" "}
                        <span className="font-mono">
                          @
                          {String(
                            process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
                          )}
                        </span>{" "}
                        to your group.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded border p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase text-gray-500">
                    Step 2
                  </div>
                  <div className="text-sm">Paste this in the group to link</div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-start">
                    <textarea
                      className="w-full rounded border p-2 text-sm font-mono"
                      rows={2}
                      readOnly
                      value={`/start@${
                        process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ||
                        "bm25r_bot"
                      } ${String((telegram as any)?.linkToken || "").trim()}`}
                    />
                    <div className="flex gap-2 md:justify-end">
                      <button
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                        disabled={!(telegram as any)?.linkToken}
                        onClick={async () => {
                          try {
                            setCopying(true);
                            await navigator?.clipboard?.writeText(
                              `/start@${
                                process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ||
                                "bm25r_bot"
                              } ${String(
                                (telegram as any)?.linkToken || ""
                              ).trim()}`
                            );
                          } catch {}
                          setTimeout(() => setCopying(false), 1200);
                        }}
                      >
                        {copying ? "Copied" : "Copy"}
                      </button>
                      <button
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                        disabled={!isOwner || refreshing}
                        onClick={async () => {
                          if (!id || !user || !isOwner) return;
                          setRefreshing(true);
                          try {
                            await issueClubTelegramLinkTokenRemote(
                              id,
                              user.uid
                            );
                          } finally {
                            setRefreshing(false);
                          }
                        }}
                      >
                        {refreshing ? "Refreshing..." : "Refresh key"}
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-600">
                    Key expires{" "}
                    {(() => {
                      const exp = Number(
                        (telegram as any)?.linkTokenExpiresAt || 0
                      );
                      if (!exp) return "soon.";
                      const ms = Math.max(0, exp - nowMs);
                      const mm = Math.floor(ms / 60000);
                      const ss = Math.floor((ms % 60000) / 1000);
                      return ms <= 0 ? "(expired)" : `in ${mm}m ${ss}s`;
                    })()}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Tip: You can paste the message as-is. The bot will confirm
                    here when linked.
                  </div>
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

                    {/* <div className="flex items-center justify-between">
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
                    </div> */}

                    <div className="rounded border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div>
                          <div className="font-medium">
                            Custom reminders (weekly)
                          </div>
                          <div className="text-[11px] text-gray-600">
                            Scheduled weekly messages to your group (max 5)
                          </div>
                        </div>
                        <button
                          className={`rounded-full border px-3 py-1 text-xs ${
                            customRemindersEnabled
                              ? "bg-blue-600 text-white"
                              : ""
                          }`}
                          disabled={!isOwner}
                          onClick={() => setCustomRemindersEnabled((v) => !v)}
                        >
                          {customRemindersEnabled ? "On" : "Off"}
                        </button>
                      </div>

                      <div className="space-y-2">
                        {customReminders.length === 0 && (
                          <div className="text-[11px] text-gray-500">
                            No reminders yet.
                          </div>
                        )}
                        {customReminders.map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between rounded border px-2 py-1"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {r.name || "Reminder"}
                              </div>
                              <div className="truncate text-[11px] text-gray-600">
                                {dowName(Number(r.dow))}{" "}
                                {String(r.hour).padStart(2, "0")}:
                                {String(r.minute).padStart(2, "0")} ·{" "}
                                {r.message}
                              </div>
                            </div>
                            <div className="ml-2 flex items-center gap-2">
                              <button
                                className={`rounded-full border px-3 py-1 text-xs ${
                                  r.enabled === false
                                    ? ""
                                    : "bg-blue-600 text-white"
                                }`}
                                disabled={!isOwner}
                                onClick={() => toggleReminder(r.id)}
                              >
                                {r.enabled === false ? "Off" : "On"}
                              </button>
                              <button
                                className="rounded border px-2 py-1 text-[11px]"
                                disabled={!isOwner}
                                onClick={() => openEditReminder(r)}
                              >
                                Edit
                              </button>
                              <button
                                className="rounded border px-2 py-1 text-[11px]"
                                disabled={!isOwner}
                                onClick={() => removeReminder(r.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-2">
                        <button
                          className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                          disabled={!isOwner || customReminders.length >= 5}
                          onClick={openAddReminder}
                        >
                          Add reminder
                        </button>
                        {customReminders.length >= 5 && (
                          <span className="ml-2 text-[11px] text-gray-500">
                            Limit reached (5)
                          </span>
                        )}
                      </div>
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
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-gray-600">
                        Timezone
                      </label>
                      <select
                        className="w-full rounded border p-2 text-sm"
                        disabled={!isOwner}
                        value={timeZone}
                        onChange={(e) => setTimeZone(e.target.value)}
                      >
                        {COMMON_TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1 text-[11px] text-gray-500">
                        Used for custom reminders and monthly summaries.
                      </div>
                    </div>
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

      {remModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setRemModalOpen(false)}
          ></div>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
            <div className="mb-2 text-base font-semibold">
              {editingId ? "Edit reminder" : "Add reminder"}
            </div>
            <div className="space-y-3">
              <Input
                label="Name"
                value={remName}
                onChange={(e) => setRemName(e.target.value)}
              />
              <div>
                <label className="mb-1 block text-[11px] text-gray-600">
                  Message
                </label>
                <textarea
                  className="w-full rounded border p-2 text-sm"
                  rows={3}
                  value={remMsg}
                  onChange={(e) => setRemMsg(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] text-gray-600">
                    Day of week
                  </label>
                  <select
                    className="w-full rounded border p-2 text-sm"
                    value={remDow}
                    onChange={(e) => setRemDow(e.target.value)}
                  >
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-gray-600">
                    Time (24h)
                  </label>
                  <input
                    type="time"
                    className="w-full rounded border p-2 text-sm"
                    value={remTime}
                    onChange={(e) => setRemTime(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setRemModalOpen(false)}
                className="rounded-xl border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={addReminderConfirm}
                className="rounded-xl bg-black px-3 py-1.5 text-sm text-white"
              >
                {editingId ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export const runtime = "edge";
