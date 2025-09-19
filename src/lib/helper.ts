import { Session, SessionStats, Player, PlayerAggregate } from "@/types/player";

function getPlayerCourtIndex(
  session: Session,
  playerId: string
): number | null {
  const idx = session.courts.findIndex((c) => c.playerIds.includes(playerId));
  return idx === -1 ? null : idx;
}

function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function downloadSessionJson(session: Session) {
  try {
    const data = JSON.stringify(session, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeTitle = `${session.date}_${session.time}`.replace(
      /[^a-zA-Z0-9_-]+/g,
      "-"
    );
    a.href = url;
    a.download = `badminton-session-${safeTitle}-${session.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Failed to export session JSON", e);
    alert("Failed to export session JSON.");
  }
}

function computeSessionStats(ss: Session): SessionStats {
  const playerById = new Map<string, Player>();
  ss.players.forEach((p) => playerById.set(p.id, p));

  const aggregates = new Map<string, PlayerAggregate>();
  const ensure = (pid: string) => {
    if (!aggregates.has(pid)) {
      const name = playerById.get(pid)?.name || "(deleted)";
      aggregates.set(pid, {
        playerId: pid,
        name,
        wins: 0,
        losses: 0,
        games: 0,
        points: 0,
        winRate: 0,
      });
    }
    return aggregates.get(pid)!;
  };

  const pairWins = new Map<string, { pair: string[]; wins: number }>();
  const keyForPair = (pair: string[]) => [...pair].sort().join("|");

  // Exclude voided games from all statistics
  const nonVoidedGames = (ss.games || []).filter((g) => !g.voided);

  for (const g of nonVoidedGames) {
    const a = g.sideA;
    const b = g.sideB;
    const winner = g.winner;
    // increment games for participants
    for (const pid of [...a, ...b]) ensure(pid).games += 1;
    // add scored points to each player on that side
    for (const pid of a) ensure(pid).points += g.scoreA;
    for (const pid of b) ensure(pid).points += g.scoreB;
    if (winner === "A") {
      for (const pid of a) ensure(pid).wins += 1;
      for (const pid of b) ensure(pid).losses += 1;
      if (a.length === 2) {
        const k = keyForPair(a);
        const prev = pairWins.get(k) || { pair: [...a].sort(), wins: 0 };
        prev.wins += 1;
        pairWins.set(k, prev);
      }
    } else if (winner === "B") {
      for (const pid of b) ensure(pid).wins += 1;
      for (const pid of a) ensure(pid).losses += 1;
      if (b.length === 2) {
        const k = keyForPair(b);
        const prev = pairWins.get(k) || { pair: [...b].sort(), wins: 0 };
        prev.wins += 1;
        pairWins.set(k, prev);
      }
    }
  }

  // finalize winRate
  for (const agg of aggregates.values()) {
    agg.winRate = agg.games > 0 ? agg.wins / agg.games : 0;
  }

  const leaderboard = Array.from(aggregates.values()).sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.winRate !== x.winRate) return y.winRate - x.winRate;
    if (y.points !== x.points) return y.points - x.points;
    return y.games - x.games;
  });

  const played = leaderboard.filter((p) => p.games > 0);
  const topWinner = played[0];
  let topLoser: PlayerAggregate | undefined = undefined;
  if (played.length) {
    const minWins = Math.min(...played.map((p) => p.wins));
    const losers = played.filter((p) => p.wins === minWins);
    losers.sort((x, y) => {
      if (y.losses !== x.losses) return y.losses - x.losses; // more losses is "worse"
      if (x.winRate !== y.winRate) return x.winRate - y.winRate; // lower winRate first
      return x.points - y.points; // fewer points first
    });
    topLoser = losers[0];
  }

  const topScorer = played.length
    ? played.reduce((acc, cur) => (cur.points > acc.points ? cur : acc))
    : undefined;
  const mostActive = played.length
    ? played.reduce((acc, cur) => (cur.games > acc.games ? cur : acc))
    : undefined;

  let bestPair: SessionStats["bestPair"] = undefined;
  if (pairWins.size) {
    const best = Array.from(pairWins.values()).sort(
      (a, b) => b.wins - a.wins
    )[0];
    const names = best.pair.map(
      (pid) => playerById.get(pid)?.name || "(deleted)"
    );
    bestPair = { pair: best.pair, names, wins: best.wins };
  }

  // Longest duration game (by durationMs)
  let longestDuration: SessionStats["longestDuration"] = undefined;
  const gamesWithDuration = nonVoidedGames.filter(
    (g) => typeof g.durationMs === "number" && (g.durationMs as number) > 0
  );
  if (gamesWithDuration.length) {
    const longest = gamesWithDuration.reduce((acc, cur) =>
      cur.durationMs! > (acc.durationMs || 0) ? cur : acc
    );
    const names = [
      ...(longest.sideAPlayers?.map((p) => p.name) ||
        longest.sideA.map((pid) => playerById.get(pid)?.name || "(deleted)")),
      ...(longest.sideBPlayers?.map((p) => p.name) ||
        longest.sideB.map((pid) => playerById.get(pid)?.name || "(deleted)")),
    ];
    longestDuration = {
      playerIds: longest.players || [...longest.sideA, ...longest.sideB],
      names,
      durationMs: longest.durationMs!,
    };
  }

  // Most intense game = highest (total points / minutes)
  let mostIntenseGame: SessionStats["mostIntenseGame"] = undefined;
  if (gamesWithDuration.length) {
    const enriched = gamesWithDuration.map((g) => {
      const secs = Math.max(1, (g.durationMs as number) / 1000); // avoid divide by zero
      const totalPoints = Math.max(1, (g.scoreA || 0) + (g.scoreB || 0)); // avoid divide by zero
      const sp = secs / totalPoints; // seconds per point (lower is more intense)
      return { g, sp, totalPoints };
    });
    const top = enriched.sort((a, b) => b.sp - a.sp)[0];
    mostIntenseGame = {
      gameId: top.g.id,
      courtIndex: top.g.courtIndex,
      endedAt: top.g.endedAt,
      totalPoints: top.totalPoints,
      durationMs: top.g.durationMs!,
      secondsPerPoint: top.sp,
      scoreA: top.g.scoreA,
      scoreB: top.g.scoreB,
      namesA:
        top.g.sideAPlayers?.map((p) => p.name) ||
        top.g.sideA.map((pid) => playerById.get(pid)?.name || "(deleted)"),
      namesB:
        top.g.sideBPlayers?.map((p) => p.name) ||
        top.g.sideB.map((pid) => playerById.get(pid)?.name || "(deleted)"),
    };
  }

  return {
    totalGames: nonVoidedGames.length,
    leaderboard,
    topWinner,
    topLoser,
    topScorer: topScorer
      ? {
          playerId: topScorer.playerId,
          name: topScorer.name,
          points: topScorer.points,
        }
      : undefined,
    mostActive: mostActive
      ? {
          playerId: mostActive.playerId,
          name: mostActive.name,
          games: mostActive.games,
        }
      : undefined,
    bestPair,
    longestDuration,
    mostIntenseGame,
  };
}

function formatSessionTitle(ss: Session) {
  // Avoid date-fns to keep deps light; show raw YYYY-MM-DD HH:mm
  return `${ss.date} · ${ss.time}`;
}

function isTestMode(): boolean {
  try {
    const v = String(process.env.NEXT_PUBLIC_TEST_MODE || "").toLowerCase();
    return v === "true" || process.env.NEXT_PUBLIC_TEST_MODE === "1";
  } catch {
    return false;
  }
}

export {
  downloadSessionJson,
  formatDuration,
  getPlayerCourtIndex,
  computeSessionStats,
  formatSessionTitle,
  isTestMode,
};
