"use client";
import { create } from "zustand";
import { nanoid } from "nanoid";
import type { Club, ClubFeedItem, ClubMember } from "@/types/club";

type JoinableUser = {
  uid: string;
  username?: string | null;
  displayName?: string | null;
};

interface ClubsState {
  clubs: Club[];
  getClub: (id: string) => Club | undefined;
  createClub: (owner: JoinableUser, name: string) => string;
  joinClub: (clubId: string, user: JoinableUser) => void;
  leaveClub: (clubId: string, uid: string) => void;
  addMember: (clubId: string, actorUid: string, user: JoinableUser) => void;
  kickMember: (clubId: string, actorUid: string, uid: string) => void;
  renameClub: (clubId: string, actorUid: string, name: string) => void;
  postMessage: (
    clubId: string,
    actorUid: string | undefined,
    message: string
  ) => void;
}

// Fixed timestamp to avoid hydration mismatch in SSR/CSR
const FIXED_NOW_ISO = "2025-01-01T00:00:00.000Z";
function nowIso(): string {
  return FIXED_NOW_ISO;
}

function toFeed(
  message: string,
  type: ClubFeedItem["type"],
  actorUid?: string
): ClubFeedItem {
  return {
    id: nanoid(8),
    type,
    message,
    createdAt: nowIso(),
    actorUid,
  };
}

const initialClubs: Club[] = [
  {
    id: "c-avalon",
    name: "Avalon Smashers",
    ownerUid: "40PyjBANa5cP34YVc4ctCfAwOvt2",
    members: [
      {
        uid: "owner-1",
        username: "avalonleader",
        displayName: "Ava Leader",
        joinedAt: nowIso(),
        role: "member",
      },
      {
        uid: "40PyjBANa5cP34YVc4ctCfAwOvt2",
        username: "colourincrayons",
        displayName: "colourincrayons",
        joinedAt: nowIso(),
        role: "owner",
      },
      {
        uid: "m-201",
        username: "jo",
        displayName: "Jo Chen",
        joinedAt: nowIso(),
        role: "member",
      },
    ],
    feed: [
      toFeed("Club created by Ava Leader", "system", "owner-1"),
      toFeed("Jo Chen joined the club", "join", "m-201"),
    ],
    isPublic: true,
    createdAt: nowIso(),
  },
  {
    id: "c-bishan",
    name: "Bishan Night Owls",
    ownerUid: "owner-2",
    members: [
      {
        uid: "owner-2",
        username: "nightowl",
        displayName: "Noah Owls",
        joinedAt: nowIso(),
        role: "owner",
      },
    ],
    feed: [toFeed("Club created by Noah Owls", "system", "owner-2")],
    isPublic: true,
    createdAt: nowIso(),
  },
];

export const useClubsStore = create<ClubsState>()((set, get) => ({
  clubs: initialClubs,
  getClub: (id) => get().clubs.find((c) => c.id === id),
  createClub: (owner, name) => {
    const id = nanoid(10);
    const ownerMember: ClubMember = {
      uid: owner.uid,
      username: owner.username || undefined,
      displayName: owner.displayName || undefined,
      joinedAt: nowIso(),
      role: "owner",
    };
    const club: Club = {
      id,
      name: (name || "Untitled Club").trim() || "Untitled Club",
      ownerUid: owner.uid,
      members: [ownerMember],
      feed: [toFeed("Club created", "system", owner.uid)],
      isPublic: true,
      createdAt: nowIso(),
    };
    set((s) => ({ clubs: [club, ...s.clubs] }));
    return id;
  },
  joinClub: (clubId, user) => {
    set((s) => ({
      clubs: s.clubs.map((c) => {
        if (c.id !== clubId) return c;
        if (c.members.some((m) => m.uid === user.uid)) return c;
        if ((c.members || []).length >= 30) return c;
        const member: ClubMember = {
          uid: user.uid,
          username: user.username || undefined,
          displayName: user.displayName || undefined,
          joinedAt: nowIso(),
          role: "member",
        };
        const feed = [
          toFeed(
            `${user.displayName || user.username || "Someone"} joined the club`,
            "join",
            user.uid
          ),
          ...c.feed,
        ];
        return { ...c, members: [...c.members, member], feed };
      }),
    }));
  },
  leaveClub: (clubId, uid) => {
    set((s) => ({
      clubs: s.clubs.map((c) => {
        if (c.id !== clubId) return c;
        const m = c.members.find((mm) => mm.uid === uid);
        if (!m) return c;
        if (m.role === "owner") return c; // owner cannot leave in mock
        const feed = [
          toFeed(
            `${m.displayName || m.username || "Member"} left the club`,
            "leave",
            uid
          ),
          ...c.feed,
        ];
        return {
          ...c,
          members: c.members.filter((mm) => mm.uid !== uid),
          feed,
        };
      }),
    }));
  },
  addMember: (clubId, actorUid, user) => {
    set((s) => ({
      clubs: s.clubs.map((c) => {
        if (c.id !== clubId) return c;
        if (c.ownerUid !== actorUid) return c;
        if (c.members.some((m) => m.uid === user.uid)) return c;
        if ((c.members || []).length >= 30) return c;
        const member: ClubMember = {
          uid: user.uid,
          username: user.username || undefined,
          displayName: user.displayName || undefined,
          joinedAt: nowIso(),
          role: "member",
        };
        const feed = [
          toFeed(
            `${
              user.displayName || user.username || "Member"
            } was added to the club`,
            "join",
            actorUid
          ),
          ...c.feed,
        ];
        return { ...c, members: [...c.members, member], feed };
      }),
    }));
  },
  renameClub: (clubId, actorUid, name) => {
    set((s) => ({
      clubs: s.clubs.map((c) => {
        if (c.id !== clubId) return c;
        if (c.ownerUid !== actorUid) return c;
        const val = (name || "").trim();
        if (!val) return c;
        const feed = [
          toFeed(`Club renamed to "${val}"`, "system", actorUid),
          ...c.feed,
        ];
        return { ...c, name: val, feed };
      }),
    }));
  },
  kickMember: (clubId, actorUid, uid) => {
    set((s) => ({
      clubs: s.clubs.map((c) => {
        if (c.id !== clubId) return c;
        if (c.ownerUid !== actorUid) return c;
        const m = c.members.find((mm) => mm.uid === uid);
        if (!m) return c;
        if (m.role === "owner") return c;
        const feed = [
          toFeed(
            `${
              m.displayName || m.username || "Member"
            } was removed from the club`,
            "kick",
            actorUid
          ),
          ...c.feed,
        ];
        return {
          ...c,
          members: c.members.filter((mm) => mm.uid !== uid),
          feed,
        };
      }),
    }));
  },
  postMessage: (clubId, actorUid, message) => {
    set((s) => ({
      clubs: s.clubs.map((c) =>
        c.id === clubId
          ? { ...c, feed: [toFeed(message, "message", actorUid), ...c.feed] }
          : c
      ),
    }));
  },
}));

export type { ClubsState };
