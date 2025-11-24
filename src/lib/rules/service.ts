export type Team = "A" | "B";
export type CourtSide = "left" | "right"; // relative to serving side
export type Zone = "top" | "bottom"; // screen-space within each half

export interface CourtAssign {
  A: { top: string[]; bottom: string[] };
  B: { top: string[]; bottom: string[] };
}

export interface ServiceState {
  servingSide: Team | null;
  serverName: string | null;
  serviceCourt: CourtSide; // left/right relative to serving side
}

export interface Scores {
  scoreA: number;
  scoreB: number;
}

export interface NextService extends ServiceState {
  receivingSide: Team;
  warnings?: string[];
}

export type Role = "server" | "serverPartner" | "receiver" | "receiverPartner";

export interface TargetAssignment {
  player: string;
  team: Team;
  zone: Zone;
  role: Role;
}

export interface TargetPlan {
  targets: TargetAssignment[];
  warnings?: string[];
}

export function getParityServiceCourt(servingSideScore: number): CourtSide {
  return servingSideScore % 2 === 0 ? "right" : "left";
}

// Mapping of relative service-court (left/right) to screen-space zone(top/bottom)
// Assumes Team A is the left half facing right; Team B is the right half facing left.
// Therefore:
// - Team A: right court = bottom; left court = top
// - Team B: right court = top;    left court = bottom
export function sideZoneForServiceCourt(team: Team, court: CourtSide): Zone {
  if (team === "A") return court === "right" ? "bottom" : "top";
  return court === "right" ? "top" : "bottom";
}

function playersOnTeam(assign: CourtAssign, team: Team): string[] {
  return [...assign[team].top, ...assign[team].bottom];
}

function pickPlayerInZone(
  assign: CourtAssign,
  team: Team,
  zone: Zone
): string | null {
  const list = assign[team][zone];
  return list && list.length > 0 ? list[0] : null;
}

export function computeNextService(
  prev: { scores: Scores; service: ServiceState },
  rallyWinner: Team,
  isDoubles: boolean,
  assign: CourtAssign
): NextService {
  const nextScores: Scores = {
    scoreA: prev.scores.scoreA + (rallyWinner === "A" ? 1 : 0),
    scoreB: prev.scores.scoreB + (rallyWinner === "B" ? 1 : 0),
  };
  const nextServingSide: Team = rallyWinner;
  const nextServingScore =
    nextServingSide === "A" ? nextScores.scoreA : nextScores.scoreB;
  const nextCourt = getParityServiceCourt(nextServingScore);
  const receivingSide: Team = nextServingSide === "A" ? "B" : "A";

  let serverName: string | null = prev.service.serverName;
  const serviceChanged = prev.service.servingSide !== nextServingSide;

  if (!isDoubles) {
    const only = playersOnTeam(assign, nextServingSide)[0] || null;
    serverName = only;
  } else if (serviceChanged) {
    // On service change, server is whoever occupies the parity court
    const zone = sideZoneForServiceCourt(nextServingSide, nextCourt);
    serverName =
      pickPlayerInZone(assign, nextServingSide, zone) ||
      // fallback to the other zone if empty
      pickPlayerInZone(
        assign,
        nextServingSide,
        zone === "top" ? "bottom" : "top"
      ) ||
      null;
    // If still null, we'll warn in the plan
  } else {
    // Serving side holds; same server continues (they will switch court by parity)
    // If unknown, attempt to infer by parity zone
    if (!serverName) {
      const zone = sideZoneForServiceCourt(nextServingSide, nextCourt);
      serverName =
        pickPlayerInZone(assign, nextServingSide, zone) ||
        pickPlayerInZone(
          assign,
          nextServingSide,
          zone === "top" ? "bottom" : "top"
        ) ||
        null;
    }
  }

  return {
    servingSide: nextServingSide,
    serverName,
    serviceCourt: nextCourt,
    receivingSide,
  };
}

export function computeTargetPlan(
  service: NextService,
  isDoubles: boolean,
  assign: CourtAssign
): TargetPlan {
  const targets: TargetAssignment[] = [];
  const warnings: string[] = [];
  const { servingSide, serverName, serviceCourt, receivingSide } = service;
  if (!servingSide || !serviceCourt) {
    return { targets, warnings: ["Serving side not set"] };
  }
  const serverZone = sideZoneForServiceCourt(servingSide, serviceCourt);
  const partnerZone: Zone = serverZone === "top" ? "bottom" : "top";

  // Server
  if (serverName) {
    targets.push({
      player: serverName,
      team: servingSide,
      zone: serverZone,
      role: "server",
    });
  } else {
    warnings.push("Server not determined");
  }

  // Serving partner (doubles)
  if (isDoubles) {
    const teamPlayers = playersOnTeam(assign, servingSide);
    const partner = teamPlayers.find((p) => p !== serverName) || null;
    if (partner) {
      targets.push({
        player: partner,
        team: servingSide,
        zone: partnerZone,
        role: "serverPartner",
      });
    }
  }

  // Receiver and partner
  const receiverZone = sideZoneForServiceCourt(receivingSide, serviceCourt);
  const receiverPartnerZone: Zone = receiverZone === "top" ? "bottom" : "top";

  const recvPlayers = playersOnTeam(assign, receivingSide);
  if (recvPlayers.length === 1) {
    targets.push({
      player: recvPlayers[0],
      team: receivingSide,
      zone: receiverZone,
      role: "receiver",
    });
  } else if (recvPlayers.length >= 2) {
    // Try to assign receiver based on who is currently in the receiverZone
    const recvInZone =
      pickPlayerInZone(assign, receivingSide, receiverZone) || null;
    const receiverName =
      recvInZone || (recvPlayers.length ? recvPlayers[0] : null);
    const partnerName = recvPlayers.find((p) => p !== receiverName) || null;
    if (receiverName) {
      targets.push({
        player: receiverName,
        team: receivingSide,
        zone: receiverZone,
        role: "receiver",
      });
    } else {
      warnings.push("Receiver not determined");
    }
    if (partnerName) {
      targets.push({
        player: partnerName,
        team: receivingSide,
        zone: receiverPartnerZone,
        role: "receiverPartner",
      });
    }
  }

  return { targets, warnings };
}
