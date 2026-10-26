"""Local replica test for supabase/32_tournaments.sql. Never touches the live DB.

    pip install pgserver pglast psycopg --break-system-packages
    python3 tests/sql/test_32_tournaments.py

Starts a throwaway Postgres (pgserver, /tmp/pgtg), loads supabase_stubs.sql,
runs the migration twice (idempotency), and plays through every format.
"""
import json, os, random, subprocess, sys, uuid
import pglast, pgserver, psycopg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MIGRATION = os.path.join(ROOT, 'supabase', '32_tournaments.sql')
HELPER_JS = '/tmp/tour_node_helper.cjs'

passed = 0
def ok(cond, msg):
    global passed
    if not cond:
        raise AssertionError(msg)
    passed += 1

# ---------------------------------------------------------------- pglast
sql_text = open(MIGRATION, encoding='utf-8').read()
stmts = pglast.parse_sql(sql_text)
ok(len(stmts) > 20, 'pglast parsed the migration')
for raw in stmts:
    node = raw.stmt
    if type(node).__name__ == 'CreateFunctionStmt':
        src = sql_text[raw.stmt_location: raw.stmt_location + raw.stmt_len] if raw.stmt_len else sql_text[raw.stmt_location:]
        lang = [o.arg.sval for o in node.options if o.defname == 'language'][0]
        if lang == 'plpgsql':
            pglast.parser.parse_plpgsql_json(src + ';')   # raises on a syntax error
            n_pl = globals().get('n_pl', 0) + 1
print(f'pglast: migration ({len(stmts)} statements) + {n_pl} plpgsql bodies parse')

# ---------------------------------------------------------------- node helper
subprocess.run(['npx', '--yes', 'esbuild@0.23.0', os.path.join(HERE, 'node_helper.js'), '--bundle',
                '--platform=node', f'--outfile={HELPER_JS}', '--log-level=warning'], check=True, cwd=ROOT)
def js(req):
    res = subprocess.run(['node', HELPER_JS], input=json.dumps(req), capture_output=True, text=True, check=True)
    return json.loads(res.stdout)

# ---------------------------------------------------------------- database
srv = pgserver.get_server('/tmp/pgtg', cleanup_mode=None)
admin = psycopg.connect(srv.get_uri(), autocommit=True)
admin.execute('drop database if exists tour_test')
admin.execute('create database tour_test')
uri = srv.get_uri('tour_test')
su = psycopg.connect(uri, autocommit=True)
su.execute(open(os.path.join(HERE, 'supabase_stubs.sql'), encoding='utf-8').read())
su.execute(sql_text)
su.execute(sql_text)   # idempotent
print('migration ran twice')

class As:
    """A connection acting as one signed-in user (role authenticated)."""
    def __init__(self, uid, role='authenticated'):
        self.c = psycopg.connect(uri, autocommit=True)
        self.c.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid) if uid else '',))
        self.c.execute(f'set role {role}')
    def q(self, sql, *args):
        cur = self.c.execute(sql, args)
        return cur.fetchall() if cur.description else None
    def one(self, sql, *args):
        r = self.q(sql, *args)
        return r[0][0] if r else None
    def fails(self, sql, *args, match=''):
        try:
            self.q(sql, *args)
        except psycopg.Error as e:
            msg = str(e)
            if match and match not in msg:
                raise AssertionError(f'expected "{match}", got: {msg}')
            return msg
        raise AssertionError(f'expected failure: {sql}')

def S(sql, *args):
    cur = su.execute(sql, args)
    return cur.fetchall() if cur.description else None

def profile(name):
    uid = uuid.uuid4()
    S('insert into profiles (id, full_name) values (%s, %s)', uid, name)
    return uid

org = profile('Organizer'); other = profile('Other organizer'); outsider = profile('Outsider')
O = As(org); X = As(other); OUT = As(outsider); ANON = As(None, 'anon')

def make_event(n_accepted, extra_pending=0, title='Cup'):
    pid = O.one("insert into posts (author_id, title, team_mode) values (%s, %s, 'team') returning id", org, title)
    players = []
    for i in range(n_accepted + extra_pending):
        u = profile(f'P{i}')
        S("insert into applications (post_id, applicant_id, status) values (%s, %s, %s)",
          pid, u, 'accepted' if i < n_accepted else 'pending')
        players.append(u)
    return pid, players[:n_accepted], players[n_accepted:]

def teams_of(pid):
    rows = S('select t.id, t.seed, t.group_no, count(m.user_id) from event_teams t '
             'left join event_team_members m on m.team_id = t.id where t.post_id = %s group by t.id order by t.seed', pid)
    return [{'id': str(r[0]), 'seed': r[1], 'group_no': r[2], 'n': r[3]} for r in rows]

def matches_of(pid):
    rows = S('select id, stage, group_no, round, slot, team_a, team_b, src_a, src_b, score_a, score_b, winner, status, '
             'next_match_id, next_slot from matches where post_id = %s order by stage, round, slot, group_no', pid)
    keys = ['id', 'stage', 'group_no', 'round', 'slot', 'team_a', 'team_b', 'src_a', 'src_b', 'score_a', 'score_b',
            'winner', 'status', 'next_match_id', 'next_slot']
    return [{k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in zip(keys, r)} for r in rows]

def stage(pid):
    return S('select tournament_stage from posts where id = %s', pid)[0][0]

def start(pid, fmt, g=None, k=None):
    sched = js({'mode': 'gen', 'teams': teams_of(pid), 'format': fmt, 'groupCount': g, 'advance': k})
    return O.one('select save_schedule(%s, %s, %s, %s, %s::jsonb, %s::jsonb)', pid, fmt, g, k,
                 json.dumps(sched['groups']), json.dumps(sched['matches']))

def play_ready(pid, rng, allow_draw=True):
    """Reports every match that has both teams and isn't done. Returns how many."""
    n = 0
    for m in matches_of(pid):
        if m['status'] == 'done' or not m['team_a'] or not m['team_b']:
            continue
        a, b = rng.randint(0, 4), rng.randint(0, 4)
        if m['stage'] == 'playoff' and a == b:
            O.q('select report_score(%s, %s, %s, %s)', m['id'], a, b, m['team_a'])
        else:
            O.q('select report_score(%s, %s, %s)', m['id'], a, b)
        n += 1
    return n

rng = random.Random(7)

# ================================================================ RLS + grants
P, players, pending = make_event(11, extra_pending=1)
X.fails('select form_teams(%s, 3)', P, match='Only the organizer')
ANON.fails('select form_teams(%s, 3)', P, match='permission denied')
OUT.fails('insert into event_teams (post_id, name) values (%s, %s)', P, 'Hack', match='row-level security')
ok(ANON.fails('select * from event_teams') is not None, 'anon cannot read event_teams')
OUT.fails('select group_standings(%s)', P, match='permission denied')
OUT.fails('select _tournament_places(%s)', P, match='permission denied')
OUT.fails('select push_notification(%s, %s, %s, %s, %s)', outsider, 'x', 'x', 'x', 'x', match='permission denied')

# ================================================================ form_teams
ok(O.one('select form_teams(%s, 3)', P) == 4, '11 players / 3 → 4 teams')
ts = teams_of(P)
ok(sorted(t['n'] for t in ts) == [2, 3, 3, 3], f'balanced sizes {ts}')
members = {str(r[0]) for r in S('select user_id from event_team_members where post_id = %s', P)}
ok(members == {str(u) for u in players}, 'every accepted player placed, pending one not')
ok(stage(P) == 'teams', 'stage teams')
ok(S("select team_size from posts where id = %s", P)[0][0] == 3, 'team_size stored')
note_count = lambda t, pid=P: S("select count(*) from notifications where type = %s and link like %s", t, f'%{pid}')[0][0]
ok(note_count('event_team') == 11, 'one team notification per player')
O.q('select form_teams(%s, 2)', P)
ok(len(teams_of(P)) == 6 and sorted(t['n'] for t in teams_of(P)) == [1, 2, 2, 2, 2, 2], '11 / 2 → 6 teams')
ok(note_count('event_team') == 11, 'reshuffle does not notify again')
O.fails('select form_teams(%s, 1)', P, match='between 2 and 20')
OUT.q('select 1')
ok(len(OUT.q('select id from event_teams where post_id = %s', P)) == 6, 'signed-in users can read the teams')
ok(OUT.q('select * from event_team_members where post_id = %s', P), 'and the members')
ok(OUT.q('delete from event_team_members where post_id = %s returning 1', P) == [], 'outsider delete removes nothing')
ok(len(teams_of(P)) == 6 and sum(t['n'] for t in teams_of(P)) == 11, 'still intact')

few, few_players, _ = make_event(1, title='Tiny')
O.fails('select form_teams(%s, 2)', few, match='at least 2 players')

# stage can't be set by hand
O.q("update posts set tournament_stage = 'finished' where id = %s", P)
ok(stage(P) == 'teams', 'client cannot change tournament_stage')
pid_new = O.one("insert into posts (author_id, title, tournament_stage) values (%s, 'x', 'finished') returning id", org)
ok(stage(pid_new) == 'setup', 'new post always starts in setup')

# ================================================================ move / rename
t0, t1 = teams_of(P)[0]['id'], teams_of(P)[1]['id']
O.q('select move_player(%s, %s, %s)', P, players[0], t1)
ok(str(S('select team_id from event_team_members where post_id=%s and user_id=%s', P, players[0])[0][0]) == t1, 'moved')
O.fails('select move_player(%s, %s, %s)', P, pending[0], t0, match='Only accepted players')
other_post, _, _ = make_event(2, title='Other')
O.q('select form_teams(%s, 2)', other_post)
O.fails('select move_player(%s, %s, %s)', P, players[0], teams_of(other_post)[0]['id'], match='not part of this event')
X.fails('select move_player(%s, %s, %s)', P, players[0], t0, match='Only the organizer')
O.q('select rename_team(%s, %s)', t0, '  Pakhtakor  ')
ok(S('select name from event_teams where id = %s', t0)[0][0] == 'Pakhtakor', 'renamed + trimmed')
O.fails('select rename_team(%s, %s)', t0, '   ', match='1 to 40')
X.fails('select rename_team(%s, %s)', t0, 'Mine', match='Only the organizer')
# take the 1-player team's player and put him back so every team has players
# (and check an emptied team is dropped by save_schedule)
O.q('select move_player(%s, %s, null)', P, players[0])
ok(not S('select 1 from event_team_members where post_id=%s and user_id=%s', P, players[0]), 'removed from teams')
O.q('select move_player(%s, %s, %s)', P, players[0], t0)

# ================================================================ playoff with byes (6 teams)
ok(len(teams_of(P)) == 6, 'six teams')
O.fails('select report_score(%s, 1, 0)', str(uuid.uuid4()), match='Match not found')
n = start(P, 'playoff')
ok(n == 5, f'6-team playoff = 5 matches, got {n}')
ok(stage(P) == 'running', 'running')
ok(note_count('event_matches') == 11, 'everyone told the matches are out')
ms = matches_of(P)
seeds = {t['id']: t['seed'] for t in teams_of(P)}
r2 = [m for m in ms if m['round'] == 2]
byes = sorted(seeds[x] for m in r2 for x in (m['team_a'], m['team_b']) if x)
ok(byes == [1, 2], f'seeds 1 and 2 have byes, got {byes}')
O.fails('select save_schedule(%s, %s, null, null, %s::jsonb, %s::jsonb)', P, 'playoff', '[]', '[{"key":"x","stage":"playoff"}]',
        match='already exist')
O.q("update posts set format = 'groups' where id = %s", P)
ok(S('select format from posts where id=%s', P)[0][0] == 'playoff', 'format locked while running')

# a match whose teams aren't known yet
final = [m for m in ms if m['next_match_id'] is None][0]
O.fails('select report_score(%s, 1, 0)', final['id'], match='Both teams')
r1 = [m for m in ms if m['round'] == 1]
X.fails('select report_score(%s, 1, 0)', r1[0]['id'], match='Only the organizer')
O.fails('select report_score(%s, 2, 2)', r1[0]['id'], match='needs a winner')
O.fails('select report_score(%s, -1, 2)', r1[0]['id'], match='between 0 and 999')
O.q('select report_score(%s, 2, 2, %s)', r1[0]['id'], r1[0]['team_b'])   # penalties: B wins
nx = [m for m in matches_of(P) if m['id'] == r1[0]['next_match_id']][0]
ok(nx['team_' + r1[0]['next_slot']] == r1[0]['team_b'], 'winner advanced into the next slot')
O.q('select report_score(%s, 3, 1)', r1[0]['id'])                         # fix: A actually won
nx = [m for m in matches_of(P) if m['id'] == r1[0]['next_match_id']][0]
ok(nx['team_' + r1[0]['next_slot']] == r1[0]['team_a'], 'changed winner re-propagated')
O.q('select clear_score(%s)', r1[0]['id'])
nx = [m for m in matches_of(P) if m['id'] == r1[0]['next_match_id']][0]
ok(nx['team_' + r1[0]['next_slot']] is None, 'cleared result empties the next slot')
ok([m for m in matches_of(P) if m['id'] == r1[0]['id']][0]['status'] == 'scheduled', 'cleared → scheduled')
O.q('select report_score(%s, 3, 1)', r1[0]['id'])
# play the semi that r1[0] feeds, then try to change r1[0]
O.q('select report_score(%s, 1, 0)', r1[1]['id'])
semi = [m for m in matches_of(P) if m['id'] == r1[0]['next_match_id']][0]
O.q('select report_score(%s, 4, 0)', semi['id'])
O.fails('select report_score(%s, 0, 3)', r1[0]['id'], match='next match was already played')
O.fails('select clear_score(%s)', r1[0]['id'], match='next match was already played')
O.q('select report_score(%s, 5, 1)', r1[0]['id'])   # same winner, new score: fine
O.fails('select award_top_teams(%s)', P, match='Finish the matches first')
while play_ready(P, rng):
    pass
ok(stage(P) == 'finished', 'final played → finished')

# ================================================================ award_top_teams
places = S('select team_id, place from _tournament_places(%s) order by place', P)
ok([p[1] for p in places] == [1, 2, 3, 3], f'places 1,2,3,3 got {places}')
js_places = js({'mode': 'podium', 'format': 'playoff', 'teams': teams_of(P), 'matches': matches_of(P)})
ok(sorted((str(t), p) for t, p in places) == sorted((x['team_id'], x['place']) for x in js_places), 'SQL places = app podium')
expected = sum(S('select count(*) from event_team_members where team_id = %s', t)[0][0] for t, _ in places)
X.fails('select award_top_teams(%s)', P, match='Only the organizer')
got = O.one('select award_top_teams(%s)', P)
ok(got == expected, f'awards for every podium player ({got} vs {expected})')
ok(O.one('select award_top_teams(%s)', P) == 0, 'second run gives nothing (idempotent)')
badge = S('select name, emoji, organizer_id from badges where post_id = %s', P)[0]
ok(badge[1] == '🏆' and str(badge[2]) == str(org) and badge[0] == 'Cup', 'default badge created')
pts = S('select place, min(points), max(points), min(kind), count(*) from awards where post_id=%s group by place order by place', P)
ok([(r[0], r[1], r[2], r[3]) for r in pts] == [(1, 100, 100, 'winner'), (2, 75, 75, 'winner'), (3, 50, 50, 'winner')],
   f'points 100/75/50 {pts}')
ok(S("select count(*) from notifications where type='award' and link like %s", f'%{P}')[0][0] == expected,
   'each winner notified once (award trigger)')
ok(all(str(r[0]) == str(org) for r in S('select awarded_by from awards where post_id=%s', P)), 'awarded_by = organizer')

# reset → teams again, schedule again
O.q('select reset_tournament(%s)', P)
ok(stage(P) == 'teams' and not matches_of(P), 'reset: back to teams, matches gone')
ok(S('select count(*) from awards where post_id=%s', P)[0][0] == expected, 'reset keeps the medals')

# ================================================================ every playoff size 2..16 with byes
for n_teams in range(2, 17):
    pid, _, _ = make_event(n_teams * 2, title=f'P{n_teams}')
    O.q('select form_teams(%s, 2)', pid)
    ok(len(teams_of(pid)) == n_teams, 'team count')
    start(pid, 'playoff')
    ok(len(matches_of(pid)) == n_teams - 1, f'{n_teams}: n-1 matches')
    rounds = 0
    while play_ready(pid, rng):
        rounds += 1
    ok(stage(pid) == 'finished', f'{n_teams}-team playoff finishes')
    ok(all(m['status'] == 'done' for m in matches_of(pid)), 'every match played')
    exp = 2 + (1 if n_teams == 3 else 2 if n_teams >= 4 else 0)
    ok(len(S('select * from _tournament_places(%s)', pid)) == exp, f'{n_teams}: {exp} places')
print('playoff 2..16 played through')

# ================================================================ versus
V, vp, _ = make_event(6, title='Derby')
O.q('select form_teams(%s, 3)', V)
start(V, 'versus')
m = matches_of(V)
ok(len(m) == 1 and m[0]['stage'] == 'playoff' and m[0]['next_match_id'] is None, 'versus: one final')
O.fails('select report_score(%s, 1, 1)', m[0]['id'], match='needs a winner')
O.q('select report_score(%s, 0, 2)', m[0]['id'])
ok(stage(V) == 'finished', 'versus finished')
ok(O.one('select award_top_teams(%s)', V) == 6, 'both teams get medals (1st and 2nd)')

# ================================================================ groups only (draws, table → places)
G, gp, _ = make_event(10, title='League')
O.q('select form_teams(%s, 2)', G)   # 5 teams
start(G, 'groups', 1)
gm = matches_of(G)
ok(len(gm) == 10 and all(m['stage'] == 'group' for m in gm), '5-team league = 10 matches')
O.q('select report_score(%s, 1, 1)', gm[0]['id'])
ok([m for m in matches_of(G) if m['id'] == gm[0]['id']][0]['winner'] is None, 'group draw allowed, no winner')
while play_ready(G, rng):
    pass
ok(stage(G) == 'finished', 'all group matches done → finished')
sql_tab = S('select team_id, rank, pts, gf, ga from group_standings(%s) order by rank', G)
js_tab = js({'mode': 'standings', 'teams': teams_of(G), 'matches': matches_of(G)})['1']
ok([str(r[0]) for r in sql_tab] == [r['team_id'] for r in js_tab], 'SQL table order = app table order')
ok([r[2] for r in sql_tab] == [r['pts'] for r in js_tab], 'same points')
places = S('select team_id, place from _tournament_places(%s) order by place', G)
js_places = js({'mode': 'podium', 'format': 'groups', 'teams': teams_of(G), 'matches': matches_of(G)})
ok([(str(t), p) for t, p in places] == [(x['team_id'], x['place']) for x in js_places], 'groups podium matches the app')
ok(O.one('select award_top_teams(%s)', G) == 6, '3 teams × 2 players awarded')
# editing after finishing is allowed in a league and keeps it finished
O.q('select report_score(%s, 9, 0)', gm[1]['id'])
ok(stage(G) == 'finished', 'still finished after an edit')

# ================================================================ hybrid
for (n_players, size, g, k) in [(12, 2, 2, 2), (18, 2, 3, 2), (16, 2, 2, 3), (20, 2, 2, 1), (24, 3, 2, 2)]:
    H, hp, _ = make_event(n_players, title='Hybrid')
    O.q('select form_teams(%s, %s)', H, size)
    n_teams = len(teams_of(H))
    start(H, 'hybrid', g, k)
    hm = matches_of(H)
    po = [m for m in hm if m['stage'] == 'playoff']
    ok(len(po) == g * k - 1, f'hybrid {n_teams}/{g}/{k}: playoff size')
    ok(all(m['team_a'] is None and m['team_b'] is None for m in po), 'playoff starts empty')
    ok(all(t['group_no'] for t in teams_of(H)), 'every team has a group')
    groups = [m for m in hm if m['stage'] == 'group']
    for m in groups[:-1]:
        O.q('select report_score(%s, %s, %s)', m['id'], rng.randint(0, 3), rng.randint(0, 3))
    ok(all(m['team_a'] is None and m['team_b'] is None for m in matches_of(H) if m['stage'] == 'playoff'),
       'playoff still empty with one group match left')
    O.fails('select report_score(%s, 1, 0)', po[-1]['id'], match='Both teams')
    O.q('select report_score(%s, 2, 1)', groups[-1]['id'])
    tables = js({'mode': 'standings', 'teams': teams_of(H), 'matches': matches_of(H)})
    by_src = {f"G{gn}#{r['rank']}": r['team_id'] for gn, rows in tables.items() for r in rows}
    for m in matches_of(H):
        if m['stage'] != 'playoff':
            continue
        for s in 'ab':
            if m['src_' + s]:
                ok(m['team_' + s] == by_src[m['src_' + s]], f"{m['src_' + s]} filled from the app's table")
    # editing a group result before the playoff starts refills the slots
    O.q('select report_score(%s, 0, 7)', groups[0]['id'])
    tables = js({'mode': 'standings', 'teams': teams_of(H), 'matches': matches_of(H)})
    by_src = {f"G{gn}#{r['rank']}": r['team_id'] for gn, rows in tables.items() for r in rows}
    for m in matches_of(H):
        for s in 'ab':
            if m['stage'] == 'playoff' and m['src_' + s]:
                ok(m['team_' + s] == by_src[m['src_' + s]], 'refilled after an edit')
    # clearing a group result empties the playoff again
    O.q('select clear_score(%s)', groups[0]['id'])
    ok(all(not (m['src_a'] and m['team_a']) and not (m['src_b'] and m['team_b']) for m in matches_of(H) if m['stage'] == 'playoff'),
       'cleared group result empties the src slots')
    O.q('select report_score(%s, 1, 1)', groups[0]['id'])
    play_ready(H, rng)   # first playoff round
    if any(m['stage'] == 'playoff' and m['status'] == 'done' for m in matches_of(H)):
        O.fails('select report_score(%s, 1, 0)', groups[1]['id'], match='group results are locked')
    while play_ready(H, rng):
        pass
    ok(stage(H) == 'finished', f'hybrid {n_teams}/{g}/{k} finished')
    pl = S('select place from _tournament_places(%s) order by place', H)
    ok(pl[0][0] == 1 and pl[1][0] == 2, 'hybrid podium')
    first = O.one('select award_top_teams(%s)', H)
    ok(first > 0 and O.one('select award_top_teams(%s)', H) == 0, 'hybrid awards idempotent')
print('hybrid configs played through')

# ================================================================ visibility of removed events
S("update posts set moderation = 'removed' where id = %s", G)
ok(OUT.q('select id from event_teams where post_id = %s', G) == [], 'removed event: teams hidden from others')
ok(len(O.q('select id from event_teams where post_id = %s', G)) == 5, 'organizer still sees them')
ok(OUT.q('select id from matches where post_id = %s', G) == [], 'removed event: matches hidden')

# legacy columns untouched; schema sanity
ok(S("select count(*) from information_schema.columns where table_name='posts' and column_name in "
     "('team_size','format','group_count','advance_per_group','tournament_stage')")[0][0] == 5, 'posts columns')
S('delete from posts where id = %s', P)
ok(S('select count(*) from event_teams where post_id=%s', P)[0][0] == 0, 'cascade delete')
print(f'ALL SQL TESTS PASSED ({passed} checks)')
