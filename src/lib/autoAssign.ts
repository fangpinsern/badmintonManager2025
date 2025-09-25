import { Session, Player } from "@/types/player";

type Weights = {
  closeW: number;
  withinW: number;
  partnerRepeatW: number;
  oppRepeatW: number;
  restW: number;
  fairnessW: number;
  genderSoftPenalty: number;
  randomW: number;
};

type InternalCfg = {
  respectGender: "hard" | "soft" | "off";
  blacklistMode: "hard" | "soft";
  maxKSingles: number;
  maxKDoubles: number;
  weights: Weights;
};

const DEFAULT_WEIGHTS: Weights = {
  closeW: 5000,
  withinW: 500,
  partnerRepeatW: 50,
  oppRepeatW: 100,
  restW: 150,
  fairnessW: 1,
  genderSoftPenalty: 500,
  randomW: 0,
};

function buildConfig(ss: Session): InternalCfg {
  const cfg = ss.autoAssignConfig || {};
  const priority = cfg.priority || "competitiveness";
  const w: Weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights || {}) };
  if (priority === "variety") {
    w.closeW = w.closeW / 2;
    w.partnerRepeatW = w.partnerRepeatW * 2;
    w.oppRepeatW = w.oppRepeatW * 2;
  } else if (priority === "rest") {
    w.restW = w.restW * 2;
  }
  const respectGender: InternalCfg["respectGender"] = cfg.respectGender
    ? cfg.respectGender
    : ss.autoAssignConfig?.balanceGender ?? true
    ? "soft"
    : "off";
  const blacklistMode: InternalCfg["blacklistMode"] =
    cfg.blacklistMode || "hard";
  const maxKSingles = cfg.maxKSingles ?? 12;
  const maxKDoubles = cfg.maxKDoubles ?? 12;
  return { respectGender, blacklistMode, maxKSingles, maxKDoubles, weights: w };
}

const D = 400;
const expWin = (s1: number, s2: number) =>
  1 / (1 + Math.pow(10, -(s1 - s2) / D));

function ratingOf(ss: Session, id: string): number {
  return ss.ratings?.[id] ?? 1200;
}

function synergyOf(ss: Session, a: string, b: string): number {
  const sa = ss.synergy?.[a]?.[b];
  const sb = ss.synergy?.[b]?.[a];
  return sa ?? sb ?? 0;
}

function teamStrengthSingles(ss: Session, p: string): number {
  return ratingOf(ss, p);
}

function teamStrengthDoubles(ss: Session, a: string, b: string): number {
  return ratingOf(ss, a) + ratingOf(ss, b) + synergyOf(ss, a, b);
}

function buildCoCounts(ss: Session): Map<string, Map<string, number>> {
  const co = new Map<string, Map<string, number>>();
  const inc = (x: string, y: string) => {
    if (x === y) return;
    if (!co.has(x)) co.set(x, new Map());
    const m = co.get(x)!;
    m.set(y, (m.get(y) || 0) + 1);
  };
  for (const g of ss.games || []) {
    const ids =
      g.players && g.players.length ? g.players : [...g.sideA, ...g.sideB];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        inc(ids[i], ids[j]);
        inc(ids[j], ids[i]);
      }
    }
  }
  return co;
}

function buildStreaks(ss: Session): Map<string, number> {
  const streak = new Map<string, number>();
  const gamesSorted = [...(ss.games || [])].sort(
    (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
  );
  for (const p of ss.players) {
    let cst = 0;
    for (const g of gamesSorted) {
      const ids =
        g.players && g.players.length ? g.players : [...g.sideA, ...g.sideB];
      if (ids.includes(p.id)) cst += 1;
      else break;
    }
    streak.set(p.id, cst);
  }
  return streak;
}

function gendersMap(ss: Session): Map<string, Player["gender"]> {
  const m = new Map<string, Player["gender"]>();
  ss.players.forEach((p) => {
    if (p.gender) m.set(p.id, p.gender);
  });
  return m;
}

function isGenderSplittable(
  ids: string[],
  genders: Map<string, Player["gender"]>
): boolean {
  // Balanced possible iff counts of M and F among the 4 are even (0,2,4)
  let m = 0,
    f = 0,
    u = 0;
  for (const id of ids) {
    const g = genders.get(id);
    if (g === "M") m++;
    else if (g === "F") f++;
    else u++;
  }
  if (u > 0) return false; // unknowns make it ambiguous; treat as not splittable for hard constraint
  return m % 2 === 0 && f % 2 === 0;
}

function lexKey(team1: string[], team2: string[]): string {
  const a = [...team1].sort();
  const b = [...team2].sort();
  const [t1, t2] = a.join("|") <= b.join("|") ? [a, b] : [b, a];
  return `${t1.join("|")}__${t2.join("|")}`;
}

function scoreSingles(
  ss: Session,
  a: string,
  b: string,
  w: Weights,
  getCo: (x: string, y: string) => number,
  streak: Map<string, number>,
  gamesPlayed: Record<string, number>
): number {
  const s1 = teamStrengthSingles(ss, a);
  const s2 = teamStrengthSingles(ss, b);
  const P = expWin(s1, s2);
  const closeness = Math.abs(0.5 - P);
  const partnerRepeat = getCo(a, b);
  const oppRepeat = partnerRepeat;
  const rest = (streak.get(a) || 0) + (streak.get(b) || 0);
  const fairness = (gamesPlayed[a] || 0) + (gamesPlayed[b] || 0);
  // add slight randomness to avoid repetitive best-scoring rematches
  const randomTerm = w.randomW * Math.random();
  return (
    w.closeW * closeness +
    w.partnerRepeatW * partnerRepeat +
    w.oppRepeatW * oppRepeat +
    w.restW * rest +
    w.fairnessW * fairness +
    randomTerm
  );
}

function scoreDoublesSplit(
  ss: Session,
  A: string,
  B: string,
  C: string,
  Dp: string,
  w: Weights,
  cfg: InternalCfg,
  getCo: (x: string, y: string) => number,
  streak: Map<string, number>,
  gamesPlayed: Record<string, number>,
  isBL: (x: string, y: string) => boolean,
  genders: Map<string, Player["gender"]>
): number {
  if (cfg.blacklistMode === "hard" && (isBL(A, B) || isBL(C, Dp)))
    return Number.POSITIVE_INFINITY;
  if (
    cfg.respectGender === "hard" &&
    !isGenderSplittable([A, B, C, Dp], genders)
  )
    return Number.POSITIVE_INFINITY;

  const s1 = teamStrengthDoubles(ss, A, B);
  const s2 = teamStrengthDoubles(ss, C, Dp);
  const P = expWin(s1, s2);
  const closeness = Math.abs(0.5 - P);
  const within =
    Math.abs(ratingOf(ss, A) - ratingOf(ss, B)) +
    Math.abs(ratingOf(ss, C) - ratingOf(ss, Dp));
  const partnerRepeat = getCo(A, B) + getCo(C, Dp);
  const oppRepeat = getCo(A, C) + getCo(A, Dp) + getCo(B, C) + getCo(B, Dp);
  const rest =
    (streak.get(A) || 0) +
    (streak.get(B) || 0) +
    (streak.get(C) || 0) +
    (streak.get(Dp) || 0);
  const fairness =
    (gamesPlayed[A] || 0) +
    (gamesPlayed[B] || 0) +
    (gamesPlayed[C] || 0) +
    (gamesPlayed[Dp] || 0);
  const genderPenalty =
    cfg.respectGender === "soft" && !isGenderSplittable([A, B, C, Dp], genders)
      ? w.genderSoftPenalty
      : 0;
  const blSoftPenalty =
    cfg.blacklistMode === "soft" && (isBL(A, B) || isBL(C, Dp)) ? 1e9 : 0;
  const randomTerm = w.randomW * Math.random();
  return (
    genderPenalty +
    blSoftPenalty +
    w.closeW * closeness +
    w.withinW * within +
    w.partnerRepeatW * partnerRepeat +
    w.oppRepeatW * oppRepeat +
    w.restW * rest +
    w.fairnessW * fairness +
    randomTerm
  );
}

function buildBlacklistCheck(ss: Session) {
  const pairs = ss.autoAssignBlacklist?.pairs || [];
  return (x: string, y: string) =>
    pairs.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
}

export function computeCompetitiveAssignmentForCourt(
  ss: Session,
  courtIndex: number
): { playerIdsToAdd: string[]; pairA: string[]; pairB: string[] } | null {
  const cfg = buildConfig(ss);
  const court = ss.courts[courtIndex];
  if (!court || court.inProgress) return null;
  const isSingles = (court.mode || "doubles") === "singles";
  const cap = isSingles ? 2 : 4;
  const need = cap - court.playerIds.length;
  if (need <= 0)
    return {
      playerIdsToAdd: [],
      pairA: court.pairA || [],
      pairB: court.pairB || [],
    };

  const assigned = new Set<string>(ss.courts.flatMap((c) => c.playerIds));
  const excluded = new Set(ss.autoAssignExclude || []);
  const gamesPlayed: Record<string, number> = {};
  ss.players.forEach((p) => (gamesPlayed[p.id] = p.gamesPlayed ?? 0));
  const poolBase = ss.players
    .filter((p) => !assigned.has(p.id) && !excluded.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, games: gamesPlayed[p.id] || 0 }));
  if (poolBase.length === 0) return null;

  // Sort by fairness baseline
  poolBase.sort((a, b) => a.games - b.games || a.name.localeCompare(b.name));

  const co = buildCoCounts(ss);
  const getCo = (a: string, b: string) => co.get(a)?.get(b) || 0;
  const streak = buildStreaks(ss);
  const isBL = buildBlacklistCheck(ss);
  const genders = gendersMap(ss);

  const initialA = [...(court.pairA || [])];
  const initialB = [...(court.pairB || [])];
  const seeded = new Set<string>(court.playerIds);
  const candidateIds = poolBase.map((p) => p.id);

  const chosen: string[] = [];
  let outPairA: string[] = [...initialA];
  let outPairB: string[] = [...initialB];

  if (isSingles) {
    const seededOnCourt = court.playerIds;
    const K = Math.min(candidateIds.length, cfg.maxKSingles);
    let best: { pair: [string, string]; score: number; tie: string } | null =
      null;
    if (seededOnCourt.length === 1) {
      const fixed = seededOnCourt[0];
      for (let j = 0; j < K; j++) {
        const cand = poolBase[j];
        const score = scoreSingles(
          ss,
          fixed,
          cand.id,
          cfg.weights,
          getCo,
          streak,
          gamesPlayed
        );
        const tie = lexKey([fixed], [cand.id]);
        if (
          !best ||
          score < best.score ||
          (score === best.score && tie < best.tie)
        )
          best = { pair: [fixed, cand.id], score, tie };
      }
    } else {
      const consider = Math.min(candidateIds.length, K);
      for (let i = 0; i < consider; i++) {
        for (let j = i + 1; j < consider; j++) {
          const a = poolBase[i].id;
          const b = poolBase[j].id;
          const score = scoreSingles(
            ss,
            a,
            b,
            cfg.weights,
            getCo,
            streak,
            gamesPlayed
          );
          const tie = lexKey([a], [b]);
          if (
            !best ||
            score < best.score ||
            (score === best.score && tie < best.tie)
          )
            best = { pair: [a, b], score, tie };
        }
      }
    }
    if (best) {
      for (const id of best.pair) if (!seeded.has(id)) chosen.push(id);
      outPairA = [best.pair[0]];
      outPairB = [best.pair[1]];
    }
  } else {
    const K = Math.min(candidateIds.length, cfg.maxKDoubles);
    const idxs: number[] = Array.from({ length: K }, (_, i) => i);
    let bestScore = Number.POSITIVE_INFINITY;
    let bestKey = "~"; // lexicographic tiebreaker
    let bestSplit: { A: string; B: string; C: string; Dp: string } | null =
      null as any;
    let bestSet: string[] = [];

    // Build set of all players that must be included (current court assignments)
    const required = new Set<string>(court.playerIds);

    const considerCombo = (ids: string[]) => {
      // Respect seeded sides: keep initialA members together, same for initialB
      const hasAllRequired = ids.every(
        (id) => required.has(id) || !required.size
      );
      if (!hasAllRequired) return;

      const splits: Array<[string, string, string, string]> = [
        [ids[0], ids[1], ids[2], ids[3]],
        [ids[0], ids[2], ids[1], ids[3]],
        [ids[0], ids[3], ids[1], ids[2]],
      ];
      for (const [A, B, C, Dp] of splits) {
        // If there are seeded teams, ensure they stay on their sides
        const teamA = [A, B];
        const teamB = [C, Dp];
        const aOk = initialA.every((x) => teamA.includes(x));
        const bOk = initialB.every((x) => teamB.includes(x));
        if (!aOk || !bOk) continue;
        const score = scoreDoublesSplit(
          ss,
          A,
          B,
          C,
          Dp,
          cfg.weights,
          cfg,
          getCo,
          streak,
          gamesPlayed,
          isBL,
          genders
        );
        if (!Number.isFinite(score)) continue;
        const key = lexKey(teamA, teamB);
        if (score < bestScore || (score === bestScore && key < bestKey)) {
          bestScore = score;
          bestKey = key;
          bestSplit = { A, B, C, Dp };
          bestSet = ids;
        }
      }
    };

    // Enumerate candidate 4-sets including required seeds
    const choose = (arr: number[], k: number, start: number, acc: number[]) => {
      if (acc.length === k) {
        const ids = acc.map((i) => poolBase[i].id);
        // Must include all required players
        const includeAll = [...required].every((r) => ids.includes(r));
        if (!includeAll) return;
        considerCombo(ids);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        acc.push(arr[i]);
        choose(arr, k, i + 1, acc);
        acc.pop();
      }
    };
    choose(idxs, Math.min(4, K), 0, []);
    if (bestSplit) {
      const pick = [bestSplit!.A, bestSplit!.B, bestSplit!.C, bestSplit!.Dp];
      for (const id of pick) if (!seeded.has(id)) chosen.push(id);
      outPairA = [bestSplit!.A, bestSplit!.B];
      outPairB = [bestSplit!.C, bestSplit!.Dp];
    }
  }

  if (chosen.length === 0) return null;
  return {
    playerIdsToAdd: chosen.slice(0, need),
    pairA: outPairA,
    pairB: outPairB,
  };
}

export function computeCompetitiveNextQueue(
  ss: Session,
  courtIndex: number
): { queue: string[]; nextA: string[]; nextB: string[] } | null {
  const cfg = buildConfig(ss);
  const court = ss.courts[courtIndex];
  if (!court) return null;
  const isSingles = (court.mode || "doubles") === "singles";
  const cap = isSingles ? 2 : 4;

  // Eligible base: not excluded, not queued elsewhere, not on this court
  const queuedElsewhere = new Set<string>();
  ss.courts.forEach((c, i) => {
    if (i !== courtIndex)
      (c.queue || []).forEach((pid) => queuedElsewhere.add(pid));
  });
  const excluded = new Set(ss.autoAssignExclude || []);
  const assigned = new Set<string>(ss.courts.flatMap((c) => c.playerIds));
  const gamesPlayed: Record<string, number> = {};
  ss.players.forEach((p) => (gamesPlayed[p.id] = p.gamesPlayed ?? 0));
  const baseSelectable = ss.players
    .filter(
      (p) => !excluded.has(p.id) && !queuedElsewhere.has(p.id)
      // allow players currently on this court to be considered for next queue
    )
    .map((p) => ({ id: p.id, name: p.name, games: gamesPlayed[p.id] || 0 }));
  if (baseSelectable.length === 0) return null;

  // Prefer free players first, but also include those currently on the same court
  const pool = baseSelectable.filter(
    (p) => !assigned.has(p.id) || court.playerIds.includes(p.id)
  );
  if (pool.length < cap) return null;

  // Sort pool by priority: prefer not currently on this court, then fairness baseline
  const onThisCourt = new Set(court.playerIds);
  pool.sort((a, b) => {
    const aOn = onThisCourt.has(a.id) ? 1 : 0;
    const bOn = onThisCourt.has(b.id) ? 1 : 0;
    return aOn - bOn || a.games - b.games || a.name.localeCompare(b.name);
  });

  const co = buildCoCounts(ss);
  const getCo = (a: string, b: string) => co.get(a)?.get(b) || 0;
  const streak = buildStreaks(ss);
  const isBL = buildBlacklistCheck(ss);
  const genders = gendersMap(ss);

  const candidateIds = pool.map((p) => p.id);
  const selected: string[] = [];
  let nextA: string[] = [];
  let nextB: string[] = [];

  if (isSingles) {
    const K = Math.min(candidateIds.length, cfg.maxKSingles);
    let best: { pair: [string, string]; score: number; tie: string } | null =
      null;
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        const a = pool[i].id;
        const b = pool[j].id;
        const score = scoreSingles(
          ss,
          a,
          b,
          cfg.weights,
          getCo,
          streak,
          gamesPlayed
        );
        const tie = lexKey([a], [b]);
        if (
          !best ||
          score < best.score ||
          (score === best.score && tie < best.tie)
        )
          best = { pair: [a, b], score, tie };
      }
    }
    if (best) {
      selected.push(...best.pair);
      nextA = [best.pair[0]];
      nextB = [best.pair[1]];
    }
  } else {
    const K = Math.min(candidateIds.length, cfg.maxKDoubles);
    const idxs: number[] = Array.from({ length: K }, (_, i) => i);
    let bestScore = Number.POSITIVE_INFINITY;
    let bestKey = "~";
    let bestSplit: { A: string; B: string; C: string; Dp: string } | null =
      null as any;
    const considerCombo = (ids: string[]) => {
      const splits: Array<[string, string, string, string]> = [
        [ids[0], ids[1], ids[2], ids[3]],
        [ids[0], ids[2], ids[1], ids[3]],
        [ids[0], ids[3], ids[1], ids[2]],
      ];
      for (const [A, B, C, Dp] of splits) {
        const score = scoreDoublesSplit(
          ss,
          A,
          B,
          C,
          Dp,
          cfg.weights,
          cfg,
          getCo,
          streak,
          gamesPlayed,
          isBL,
          genders
        );
        if (!Number.isFinite(score)) continue;
        const key = lexKey([A, B], [C, Dp]);
        if (score < bestScore || (score === bestScore && key < bestKey)) {
          bestScore = score;
          bestKey = key;
          bestSplit = { A, B, C, Dp };
        }
      }
    };
    const choose = (arr: number[], k: number, start: number, acc: number[]) => {
      if (acc.length === k) {
        considerCombo(acc.map((i) => pool[i].id));
        return;
      }
      for (let i = start; i < arr.length; i++) {
        acc.push(arr[i]);
        choose(arr, k, i + 1, acc);
        acc.pop();
      }
    };
    choose(idxs, Math.min(4, K), 0, []);
    if (bestSplit) {
      selected.push(bestSplit!.A, bestSplit!.B, bestSplit!.C, bestSplit!.Dp);
      nextA = [bestSplit!.A, bestSplit!.B];
      nextB = [bestSplit!.C, bestSplit!.Dp];
    }
  }

  if (selected.length < cap) return null;
  return { queue: selected.slice(0, cap), nextA, nextB };
}

export function applyEloAfterGame(
  ss: Session,
  sideA: string[],
  sideB: string[],
  winner: "A" | "B" | "draw"
): Session {
  // Approximate ratings using end-of-game ratings (practical compromise vs snapshot at start)
  const isDoubles = sideA.length === 2 && sideB.length === 2;
  const strengthA = isDoubles
    ? teamStrengthDoubles(ss, sideA[0], sideA[1])
    : teamStrengthSingles(ss, sideA[0]);
  const strengthB = isDoubles
    ? teamStrengthDoubles(ss, sideB[0], sideB[1])
    : teamStrengthSingles(ss, sideB[0]);
  const expectedA = expWin(strengthA, strengthB);
  const expectedB = 1 - expectedA;
  const resultA = winner === "A" ? 1 : winner === "B" ? 0 : 0.5;
  const resultB = 1 - resultA;

  const ratings = { ...(ss.ratings || {}) };
  const ratingMeta = { ...(ss.ratingMeta || {}) } as Record<
    string,
    { gamesInSession?: number }
  >;

  const kFor = (pid: string) => {
    const played =
      ratingMeta[pid]?.gamesInSession ??
      ss.players.find((p) => p.id === pid)?.gamesPlayed ??
      0;
    if (played < 5) return 48;
    if (played < 10) return 32;
    return 16;
  };

  const update = (ids: string[], result: number, expected: number) => {
    for (const id of ids) {
      const k = kFor(id);
      const current = ratings[id] ?? 1200;
      ratings[id] = current + k * (result - expected);
      const g = (ratingMeta[id]?.gamesInSession ?? 0) + 1;
      ratingMeta[id] = { ...(ratingMeta[id] || {}), gamesInSession: g };
    }
  };

  update(sideA, resultA, expectedA);
  update(sideB, resultB, expectedB);

  return { ...ss, ratings, ratingMeta };
}
