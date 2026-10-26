// Unit tests for lib/tournament.js. Run:
//   npx --yes esbuild@0.23.0 tests/tournament.test.js --bundle --platform=node --outfile=/tmp/tt.cjs --log-level=warning && node /tmp/tt.cjs
import assert from 'node:assert/strict';
import {
  seedOrder, nextPow2, roundRobin, buildPlayoff, generateSchedule, scheduleProblem,
  computeStandings, podium, crossSeedEntrants, parseSrc, bracketRounds, roundName, nextMatchFor,
} from '../lib/tournament';

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; } catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; }
}
const ids = (n) => Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
const teamsOf = (n) => ids(n).map((id, i) => ({ id, seed: i + 1 }));

// Plays a playoff like report_score() does: winner goes to next_key/next_slot.
function playOut(matches, pickWinner) {
  const byKey = Object.fromEntries(matches.map((m) => [m.key, { ...m }]));
  const order = Object.values(byKey).sort((a, b) => a.round - b.round || a.slot - b.slot);
  for (const m of order) {
    assert.ok(m.team_a && m.team_b, `match ${m.key} has both teams when its round comes`);
    const w = pickWinner(m.team_a, m.team_b);
    m.winner = w; m.status = 'done';
    if (m.next_key) {
      const nx = byKey[m.next_key];
      assert.equal(nx[`team_${m.next_slot}`], null, `slot ${m.next_slot} of ${nx.key} is free`);
      nx[`team_${m.next_slot}`] = w;
    }
  }
  return Object.values(byKey);
}

test('seedOrder / nextPow2', () => {
  assert.deepEqual(seedOrder(2), [1, 2]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.equal(nextPow2(5), 8);
  assert.equal(nextPow2(8), 8);
  assert.equal(nextPow2(2), 2);
});

test('round robin 2..12: every pair once, nobody twice a round', () => {
  for (let n = 2; n <= 12; n++) {
    const list = ids(n);
    const games = roundRobin(list);
    assert.equal(games.length, (n * (n - 1)) / 2, `n=${n} game count`);
    const pairs = new Set();
    games.forEach(({ a, b }) => {
      assert.notEqual(a, b);
      const k = [a, b].sort().join('|');
      assert.ok(!pairs.has(k), `n=${n} pair ${k} twice`);
      pairs.add(k);
    });
    const rounds = {};
    games.forEach(({ round, a, b }) => {
      rounds[round] = rounds[round] ?? new Set();
      assert.ok(!rounds[round].has(a) && !rounds[round].has(b), `n=${n} someone twice in round ${round}`);
      rounds[round].add(a); rounds[round].add(b);
    });
    assert.equal(Object.keys(rounds).length, n % 2 ? n : n - 1, `n=${n} round count`);
  }
});

test('playoff 2..16: byes, links, seeds 1 and 2 meet in the final', () => {
  for (let n = 2; n <= 16; n++) {
    const list = ids(n);
    const ms = buildPlayoff(list.map((team) => ({ team })));
    const size = nextPow2(n);
    assert.equal(ms.length, n - 1, `n=${n}: n-1 matches`);
    const finals = ms.filter((m) => !m.next_key);
    assert.equal(finals.length, 1, `n=${n}: one final`);
    assert.equal(finals[0].round, Math.log2(size));
    // Each team placed exactly once; bye teams are the top seeds.
    const placed = ms.flatMap((m) => [m.team_a, m.team_b]).filter(Boolean);
    assert.deepEqual([...placed].sort(), [...list].sort(), `n=${n}: every team placed once`);
    const byes = ms.filter((m) => m.round === 2).flatMap((m) => [m.team_a, m.team_b]).filter(Boolean);
    assert.deepEqual(byes.sort(), list.slice(0, size - n).sort(), `n=${n}: byes go to the top seeds`);
    // Every slot of every match is fed exactly once (prefilled or by a feeder).
    const keys = new Set(ms.map((m) => m.key));
    ms.forEach((m) => {
      if (m.next_key) assert.ok(keys.has(m.next_key), `n=${n}: ${m.key} → missing ${m.next_key}`);
      ['a', 'b'].forEach((s) => {
        const feeders = ms.filter((x) => x.next_key === m.key && x.next_slot === s).length;
        assert.equal(feeders + (m[`team_${s}`] ? 1 : 0), 1, `n=${n}: ${m.key} slot ${s} fed once`);
      });
    });
    // Better seed always wins → 1 beats 2 in the final.
    const seed = (id) => list.indexOf(id);
    const done = playOut(ms, (a, b) => (seed(a) < seed(b) ? a : b));
    const fin = done.find((m) => !m.next_key);
    assert.deepEqual([fin.team_a, fin.team_b].sort(), n >= 2 ? [list[0], list[1]].sort() : []);
    // Random winners still produce one champion, every match playable.
    const rnd = playOut(ms, (a, b) => (Math.random() < 0.5 ? a : b));
    assert.ok(rnd.find((m) => !m.next_key).winner);
  }
});

test('versus = one final between the two teams', () => {
  const { groups, matches } = generateSchedule({ teams: teamsOf(2), format: 'versus' });
  assert.equal(groups.length, 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].stage, 'playoff');
  assert.equal(matches[0].next_key, null);
  assert.throws(() => generateSchedule({ teams: teamsOf(3), format: 'versus' }), /exactly 2 teams/);
});

test('groups: balanced groups, full round robin inside each', () => {
  for (let n = 2; n <= 20; n++) {
    for (let g = 1; g * 2 <= n; g++) {
      const { groups, matches } = generateSchedule({ teams: teamsOf(n), format: 'groups', groupCount: g });
      const sizes = Array.from({ length: g }, (_, i) => groups.filter((x) => x.group_no === i + 1).length);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `n=${n} g=${g} balanced`);
      assert.ok(Math.min(...sizes) >= 2);
      const expected = sizes.reduce((s, k) => s + (k * (k - 1)) / 2, 0);
      assert.equal(matches.length, expected, `n=${n} g=${g} match count`);
      const groupOf = Object.fromEntries(groups.map((x) => [x.team_id, x.group_no]));
      matches.forEach((m) => {
        assert.equal(m.stage, 'group');
        assert.equal(groupOf[m.team_a], m.group_no);
        assert.equal(groupOf[m.team_b], m.group_no);
      });
      assert.equal(new Set(matches.map((m) => m.key)).size, matches.length, 'unique keys');
    }
  }
});

test('hybrid: cross-seeded playoff (A1 vs B2, B1 vs A2)', () => {
  const { matches } = generateSchedule({ teams: teamsOf(8), format: 'hybrid', groupCount: 2, advance: 2 });
  const po = matches.filter((m) => m.stage === 'playoff');
  const r1 = po.filter((m) => m.round === 1).map((m) => [m.src_a, m.src_b].sort().join(' v '));
  assert.deepEqual(r1.sort(), ['G1#1 v G2#2', 'G1#2 v G2#1']);
  assert.equal(po.length, 3);
});

test('hybrid: every config — labels once, no same-group first round, valid links', () => {
  let configs = 0;
  for (let n = 2; n <= 24; n++) {
    for (let g = 1; g * 2 <= n; g++) {
      for (let k = 1; k <= Math.floor(n / g) && k <= 8; k++) {
        if (g * k < 2) continue;
        configs += 1;
        const { matches } = generateSchedule({ teams: teamsOf(n), format: 'hybrid', groupCount: g, advance: k });
        const po = matches.filter((m) => m.stage === 'playoff');
        assert.equal(po.length, g * k - 1, `n=${n} g=${g} k=${k} playoff size`);
        const labels = po.flatMap((m) => [m.src_a, m.src_b]).filter(Boolean);
        assert.deepEqual([...labels].sort(), crossSeedEntrants(g, k).map((e) => e.src).sort());
        po.forEach((m) => assert.ok(!m.team_a && !m.team_b, 'hybrid playoff starts empty'));
        if (g >= 2) {
          po.filter((m) => m.src_a && m.src_b).forEach((m) => {
            assert.notEqual(parseSrc(m.src_a).group, parseSrc(m.src_b).group,
              `n=${n} g=${g} k=${k}: ${m.src_a} vs ${m.src_b} same group in round ${m.round}`);
          });
        }
        // Byes still go to the best-placed teams (group winners first).
        const size = nextPow2(g * k);
        const round2 = po.filter((m) => m.round === 2 && size > 2).flatMap((m) => [m.src_a, m.src_b]).filter(Boolean);
        const tierOf = (s) => parseSrc(s).pos;
        const topTiers = crossSeedEntrants(g, k).slice(0, size - g * k).map((e) => tierOf(e.src)).sort();
        assert.deepEqual(round2.map(tierOf).sort(), topTiers, `n=${n} g=${g} k=${k}: byes by placing`);
        const keys = new Set(matches.map((m) => m.key));
        assert.equal(keys.size, matches.length);
        po.forEach((m) => m.next_key && assert.ok(keys.has(m.next_key)));
      }
    }
  }
  assert.ok(configs > 100);
});

test('scheduleProblem', () => {
  assert.match(scheduleProblem(1, 'playoff')[0], /at least 2/);
  assert.equal(scheduleProblem(5, 'playoff'), null);
  assert.match(scheduleProblem(5, 'groups', 3)[0], /Too many groups/);
  assert.equal(scheduleProblem(6, 'groups', 3), null);
  assert.match(scheduleProblem(6, 'hybrid', 2, 4)[0], /at most/);
  assert.match(scheduleProblem(4, 'hybrid', 1, 1)[0], /At least 2/);
  assert.equal(scheduleProblem(4, 'hybrid', 1, 2), null);
  assert.match(scheduleProblem(4, 'nope')[0], /format/);
});

test('standings: 3/1/0, goal difference, goals, seed', () => {
  const teams = [
    { id: 'a', seed: 1, group_no: 1 }, { id: 'b', seed: 2, group_no: 1 },
    { id: 'c', seed: 3, group_no: 1 }, { id: 'd', seed: 4, group_no: 1 },
  ];
  const M = (team_a, team_b, score_a, score_b) => ({ stage: 'group', status: 'done', team_a, team_b, score_a, score_b });
  const matches = [
    M('a', 'b', 1, 1), M('c', 'd', 3, 0), M('a', 'c', 0, 2), M('b', 'd', 2, 0),
    M('a', 'd', 5, 0), { stage: 'group', status: 'scheduled', team_a: 'b', team_b: 'c' },
  ];
  const t = computeStandings(teams, matches)[1];
  assert.deepEqual(t.map((r) => r.team_id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(t.map((r) => r.pts), [6, 4, 4, 0]);
  assert.equal(t[1].gd, 3); // a: 6-3
  assert.equal(t[2].gd, 2); // b: 3-1
  // Full tie → better seed first
  const tie = computeStandings(teams.slice(0, 2), [M('b', 'a', 2, 2)])[1];
  assert.deepEqual(tie.map((r) => r.team_id), ['a', 'b']);
});

test('podium: playoff final + both semi-final losers; groups table', () => {
  const list = ids(4);
  const ms = buildPlayoff(list.map((team) => ({ team })));
  const done = playOut(ms, (a, b) => (a < b ? a : b)).map((m) => ({ ...m, id: m.key, next_match_id: m.next_key }));
  const p = podium('playoff', [], done);
  assert.deepEqual(p.map((x) => [x.place, x.team_id]), [[1, 't01'], [2, 't02'], [3, 't04'], [3, 't03']]);
  assert.deepEqual(podium('playoff', [], ms), []);

  const teams = teamsOf(3).map((x) => ({ ...x, group_no: 1 }));
  const M = (team_a, team_b, score_a, score_b) => ({ stage: 'group', status: 'done', team_a, team_b, score_a, score_b });
  const gm = [M('t01', 't02', 0, 1), M('t02', 't03', 0, 2), M('t01', 't03', 3, 0)];
  assert.deepEqual(podium('groups', teams, gm).map((x) => x.team_id), ['t01', 't03', 't02']);
  assert.deepEqual(podium('groups', teams, [...gm.slice(0, 2), { ...gm[2], status: 'scheduled' }]), []);
});

test('bracket rounds, round names, next match', () => {
  const ms = buildPlayoff(ids(5).map((team) => ({ team })));
  const cols = bracketRounds(ms);
  assert.deepEqual(cols.map((c) => c.matches.length), [1, 2, 1]);
  assert.deepEqual(roundName(3, 3), ['Final', null]);
  assert.deepEqual(roundName(2, 3), ['Semi-finals', null]);
  assert.deepEqual(roundName(1, 4), ['Round {n}', { n: 1 }]);
  assert.equal(nextMatchFor('t01', ms).round, 2); // top seed has a bye
  assert.equal(nextMatchFor('t04', ms).round, 1);
});

console.log(`${passed} test groups passed${process.exitCode ? ' (with failures above)' : ''}`);
