type ClubMember = {
  uid: string;
  username?: string;
  displayName?: string;
  joinedAt: string; // ISO timestamp
  role: "owner" | "member";
};

type ClubFeedItem = {
  id: string;
  type: "system" | "join" | "leave" | "kick" | "message";
  message: string;
  createdAt: string; // ISO timestamp
  actorUid?: string;
};

type Club = {
  id: string;
  name: string;
  ownerUid: string;
  members: ClubMember[];
  feed: ClubFeedItem[];
  isPublic?: boolean;
  createdAt: string; // ISO timestamp
};

export type { Club, ClubMember, ClubFeedItem };
