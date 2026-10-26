// ---------------------------------------------------------------------------
//  Tournament maths — pure functions, no React / Supabase, so node can test
//  them directly (tests/tournament.test.js).
//
//  Formats (posts.format):
//    versus   one match between exactly two teams (stored as a 2-team playoff:
//             a single final, so it needs a winner)
//    groups   round-robin inside each group; final table decides the places
//    playoff  single elimination; non-power-of-two fields give the top seeds a
//             bye (they start in round 2 — no "bye match" is stored)
//    hybrid   groups first, then a playoff of the top K per group. The playoff
//             slots hold labels ("G1#1" = group 1, 1st place) that the server
//             fills in when the last group match is reported; seeding is
//             crossed (A1 vs B2, B1 vs A2…).
//
//  generateSchedule() returns { groups, matches } in the shape save_schedule()
//  (supabase/32_tournaments.sql) stores: every match has a temporary `key`, and
//  `next_key` / `next_slot` say where its winner goes.
// ---------------------------------------------------------------------------

export const FORMATS = ['versus', 'groups', 'playoff', 'hybrid'];
export const MAX_GROUPS = 16;
export const MAX_ADVANCE = 8;

export function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard bracket order: 1 vs P, and the top two seeds can only meet in the
// final. seedOrder(8) = [1, 8, 4, 5, 2, 7, 3, 6].
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const m = order.length * 2;
    order = order.flatMap((s) => [s, m + 1 - s]);
  }
  return order;
}

// Circle method. ids → [{ round, a, b }]; every pair meets exactly once and
// nobody plays twice in a round. Odd counts get a rest each round.
export function roundRobin(ids) {
  const arr = [...ids];
  if (arr.length < 2) return [];
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const out = [];
  let cur = arr;
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      let a = cur[i];
      let b = cur[n - 1 - i];
      if (a == null || b == null) continue;
      // Swap sides every other round so no one is always "home".
      if (r % 2 === 1 && i === 0) [a, b] = [b, a];
      out.push({ round: r + 1, a, b });
    }
    cur = [cur[0], cur[n - 1], ...cur.slice(1, n - 1)];
  }
  return out;
}

// Teams (already in seed order) → group 1..G, dealt round the table so the
// sizes differ by at most one.
export function assignGroups(teams, groupCount) {
  return teams.map((t, i) => ({ team_id: t.id, group_no: (i % groupCount) + 1 }));
}

export const srcLabel = (group, pos) => `G${group}#${pos}`;
export function parseSrc(src) {
  const m = /^G(\d+)#(\d+)$/.exec(String(src ?? ''));
  return m ? { group: Number(m[1]), pos: Number(m[2]) } : null;
}

// Group winners first (A1, B1, C1…), then runners-up (A2, B2…), …
export function crossSeedEntrants(groupCount, advance) {
  const out = [];
  for (let pos = 1; pos <= advance; pos++) {
    for (let g = 1; g <= groupCount; g++) out.push({ src: srcLabel(g, pos), group: g });
  }
  return out;
}

// The pairings already known before a ball is kicked: round-1 pairs, and
// round-2 matches between two teams that both had a bye. pos = bracket
// positions (entrant or null for a bye).
function knownMeetings(pos) {
  const out = [];
  for (let i = 0; i < pos.length; i += 2) if (pos[i] && pos[i + 1]) out.push([i, i + 1]);
  for (let i = 0; i + 3 < pos.length; i += 4) {
    const left = [i, i + 1].filter((k) => pos[k]);
    const right = [i + 2, i + 3].filter((k) => pos[k]);
    if (left.length === 1 && right.length === 1) out.push([left[0], right[0]]);
  }
  return out;
}

// Two entrants from the same group shouldn't meet straight away. Swap the
// weaker one with the closest-seeded entrant that fixes it — preferring one
// in the same situation (both with a bye, or both without), so byes stay with
// the seeds that earned them.
function avoidSameGroup(pos) {
  const isBye = (k) => !pos[k ^ 1];
  const bad = () => knownMeetings(pos).filter(([x, y]) => pos[x].group != null && pos[x].group === pos[y].group).length;
  let current = bad();
  for (let guard = 0; current > 0 && guard < pos.length * 2; guard++) {
    const meeting = knownMeetings(pos).find(([x, y]) => pos[x].group != null && pos[x].group === pos[y].group);
    const y = pos[meeting[0]].seed > pos[meeting[1]].seed ? meeting[0] : meeting[1];
    const candidates = pos
      .map((e, k) => k)
      .filter((k) => pos[k] && !meeting.includes(k))
      .sort((a, b) => (isBye(a) === isBye(y) ? 0 : 1) - (isBye(b) === isBye(y) ? 0 : 1)
        || Math.abs(pos[a].seed - pos[y].seed) - Math.abs(pos[b].seed - pos[y].seed));
    let improved = false;
    for (const z of candidates) {
      [pos[y], pos[z]] = [pos[z], pos[y]];
      const now = bad();
      if (now < current) { current = now; improved = true; break; }
      [pos[y], pos[z]] = [pos[z], pos[y]];
    }
    if (!improved) break; // can't be helped (e.g. a single group)
  }
  return pos;
}

function put(match, side, entrant) {
  if (entrant.team) match[`team_${side}`] = entrant.team;
  else match[`src_${side}`] = entrant.src;
}

// entrants: [{ team } | { src, group }] in seed order (best first).
export function buildPlayoff(entrants, { keyPrefix = 'p' } = {}) {
  const m = entrants.length;
  if (m < 2) return [];
  const size = nextPow2(m);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const key = (r, s) => `${keyPrefix}${r}-${s}`;

  const byKey = {};
  const matches = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let s = 1; s <= count; s++) {
      const mt = {
        key: key(r, s), stage: 'playoff', group_no: null, round: r, slot: s,
        team_a: null, team_b: null, src_a: null, src_b: null,
        next_key: r < rounds ? key(r + 1, Math.ceil(s / 2)) : null,
        next_slot: r < rounds ? (s % 2 ? 'a' : 'b') : null,
      };
      byKey[mt.key] = mt;
      matches.push(mt);
    }
  }

  const pos = avoidSameGroup(order.map((seed) => (seed <= m ? { ...entrants[seed - 1], seed } : null)));

  const drop = new Set();
  for (let s = 1; s <= size / 2; s++) {
    const a = pos[2 * s - 2];
    const b = pos[2 * s - 1];
    const mt = byKey[key(1, s)];
    if (a && b) {
      put(mt, 'a', a);
      put(mt, 'b', b);
      continue;
    }
    // A bye: no match; the entrant starts in round 2.
    const solo = a || b;
    drop.add(mt.key);
    if (solo) put(byKey[mt.next_key], mt.next_slot, solo);
  }
  return matches.filter((x) => !drop.has(x.key));
}

// Why this format can't run with these numbers, or null. Returns
// [english text, vars] for t().
export function scheduleProblem(nTeams, format, groupCount, advance) {
  if (!FORMATS.includes(format)) return ['Pick a format.', null];
  if (nTeams < 2) return ['Make at least 2 teams first.', null];
  if (format === 'versus' && nTeams !== 2) return ['Team vs team needs exactly 2 teams. You have {n}.', { n: nTeams }];
  if (format === 'groups' || format === 'hybrid') {
    const g = Number(groupCount);
    if (!Number.isInteger(g) || g < 1 || g > MAX_GROUPS) return ['Groups: pick a number from 1 to {n}.', { n: MAX_GROUPS }];
    if (g * 2 > nTeams) return ['Too many groups: each group needs at least 2 teams.', null];
    if (format === 'hybrid') {
      const k = Number(advance);
      const smallest = Math.floor(nTeams / g);
      if (!Number.isInteger(k) || k < 1 || k > MAX_ADVANCE) return ['Teams going through: pick a number from 1 to {n}.', { n: MAX_ADVANCE }];
      if (k > smallest) return ['Only {n} teams go through from each group at most.', { n: smallest }];
      if (g * k < 2) return ['At least 2 teams must reach the playoff.', null];
    }
  }
  return null;
}

// teams: [{ id, seed }]. Returns { groups: [{ team_id, group_no }], matches }.
export function generateSchedule({ teams, format, groupCount, advance }) {
  const sorted = [...teams].sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9) || (String(a.id) < String(b.id) ? -1 : 1));
  const problem = scheduleProblem(sorted.length, format, groupCount, advance);
  if (problem) {
    const err = new Error(problem[0]);
    err.vars = problem[1];
    throw err;
  }
  if (format === 'versus' || format === 'playoff') {
    return { groups: [], matches: buildPlayoff(sorted.map((t) => ({ team: t.id }))) };
  }
  const g = Number(groupCount);
  const groups = assignGroups(sorted, g);
  const matches = [];
  for (let gi = 1; gi <= g; gi++) {
    const ids = groups.filter((x) => x.group_no === gi).map((x) => x.team_id);
    const slots = {};
    roundRobin(ids).forEach(({ round, a, b }) => {
      slots[round] = (slots[round] ?? 0) + 1;
      matches.push({
        key: `g${gi}-${round}-${slots[round]}`, stage: 'group', group_no: gi, round, slot: slots[round],
        team_a: a, team_b: b, src_a: null, src_b: null, next_key: null, next_slot: null,
      });
    });
  }
  if (format === 'hybrid') matches.push(...buildPlayoff(crossSeedEntrants(g, Number(advance))));
  return { groups, matches };
}

// ---- Reading a stored tournament ------------------------------------------

const idOf = (m) => m.id ?? m.key;
const nextOf = (m) => m.next_match_id ?? m.next_key ?? null;

// Same order as group_standings() in SQL: points, goal difference, goals
// scored, then seed, then id.
function cmpRows(a, b) {
  return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
    || (a.seed ?? 1e9) - (b.seed ?? 1e9) || (String(a.team_id) < String(b.team_id) ? -1 : 1);
}

// teams: [{ id, group_no, seed }], matches as stored. → { [group_no]: rows[] }
export function computeStandings(teams, matches) {
  const rows = {};
  teams.filter((t) => t.group_no != null).forEach((t) => {
    rows[t.id] = { team_id: t.id, group_no: t.group_no, seed: t.seed, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
  });
  matches.filter((m) => m.stage === 'group' && m.status === 'done' && m.team_a && m.team_b).forEach((m) => {
    [[m.team_a, m.score_a, m.score_b], [m.team_b, m.score_b, m.score_a]].forEach(([id, f, a]) => {
      const r = rows[id];
      if (!r) return;
      r.played += 1;
      r.gf += f;
      r.ga += a;
      if (f > a) r.won += 1; else if (f === a) r.drawn += 1; else r.lost += 1;
    });
  });
  const out = {};
  Object.values(rows).forEach((r) => {
    r.gd = r.gf - r.ga;
    r.pts = 3 * r.won + r.drawn;
    (out[r.group_no] = out[r.group_no] ?? []).push(r);
  });
  Object.values(out).forEach((list) => {
    list.sort(cmpRows);
    list.forEach((r, i) => { r.rank = i + 1; });
  });
  return out;
}

export const groupLetter = (n) => (n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : String(n));

export function finalMatch(matches) {
  return matches.find((m) => m.stage === 'playoff' && !nextOf(m)) ?? null;
}

// Top three as [{ place, team_id }], mirroring _tournament_places() in SQL.
// Empty until the tournament is decided.
export function podium(format, teams, matches) {
  if (format === 'groups') {
    if (!matches.length || matches.some((m) => m.status !== 'done')) return [];
    const all = Object.values(computeStandings(teams, matches)).flat();
    all.sort((a, b) => a.rank - b.rank || cmpRows(a, b));
    return all.slice(0, 3).map((r, i) => ({ place: i + 1, team_id: r.team_id }));
  }
  const fin = finalMatch(matches);
  if (!fin || fin.status !== 'done' || !fin.winner) return [];
  const out = [
    { place: 1, team_id: fin.winner },
    { place: 2, team_id: fin.winner === fin.team_a ? fin.team_b : fin.team_a },
  ];
  matches
    .filter((m) => m.stage === 'playoff' && nextOf(m) === idOf(fin) && m.status === 'done' && m.winner)
    .forEach((m) => out.push({ place: 3, team_id: m.winner === m.team_a ? m.team_b : m.team_a }));
  return out.filter((x) => x.team_id);
}

// Playoff columns for the bracket view: [{ round, matches }] (by slot).
export function bracketRounds(matches) {
  const po = matches.filter((m) => m.stage === 'playoff');
  const rounds = [...new Set(po.map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((r) => ({ round: r, matches: po.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot) }));
}

// English label for t(): 'Final', 'Semi-finals', 'Quarter-finals', 'Round {n}'.
export function roundName(round, totalRounds) {
  const left = totalRounds - round;
  if (left === 0) return ['Final', null];
  if (left === 1) return ['Semi-finals', null];
  if (left === 2) return ['Quarter-finals', null];
  return ['Round {n}', { n: round }];
}

// The team's next unplayed match (group stage first, then by round).
export function nextMatchFor(teamId, matches) {
  if (!teamId) return null;
  const stageRank = (m) => (m.stage === 'group' ? 0 : 1);
  return matches
    .filter((m) => m.status !== 'done' && (m.team_a === teamId || m.team_b === teamId))
    .sort((a, b) => stageRank(a) - stageRank(b) || a.round - b.round || a.slot - b.slot)[0] ?? null;
}

// The team's latest result, for "Last: won 3–1".
export function lastMatchFor(teamId, matches) {
  if (!teamId) return null;
  const stageRank = (m) => (m.stage === 'group' ? 0 : 1);
  return matches
    .filter((m) => m.status === 'done' && (m.team_a === teamId || m.team_b === teamId))
    .sort((a, b) => stageRank(b) - stageRank(a) || b.round - a.round || b.slot - a.slot)[0] ?? null;
}
