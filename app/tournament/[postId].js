import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Modal, TextInput } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow, column } from '../../lib/theme';
import { Button, Avatar, EmptyState, Section, Segmented, Stepper, TextField, Chip } from '../../components/ui';
import FormatPicker, { formatTitle } from '../../components/FormatPicker';
import { FadeIn } from '../../components/Motion';
import { notify, confirmAsync } from '../../lib/notify';
import { t } from '../../lib/i18n';
import {
  loadTournament, acceptedPlayers, formTeams, movePlayer, renameTeam, startTournament,
  reportScore, clearScore, resetTournament, awardTopTeams,
} from '../../lib/eventTeams';
import {
  computeStandings, bracketRounds, roundName, podium, groupLetter, parseSrc, scheduleProblem, generateSchedule,
} from '../../lib/tournament';

// Teams & matches. The organizer forms teams from the accepted players,
// starts the matches, enters scores and gives medals; everyone else sees the
// same teams, tables and bracket read-only.

const STEPS = ['Teams', 'Start', 'Matches', 'Medals'];
const STEP_OF = { setup: 0, teams: 1, running: 2, finished: 3 };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));

export default function Tournament() {
  const { postId } = useLocalSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [post, setPost] = useState(null);
  const [data, setData] = useState({ teams: [], matches: [], missing: false });
  const [accepted, setAccepted] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('matches');
  const [busy, setBusy] = useState(null);
  const [sheet, setSheet] = useState(null);   // { kind: 'player' | 'rename' | 'score', … }

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
    if (!p) { setPost(null); setLoaded(true); return; }
    const [tour, acc] = await Promise.all([
      loadTournament(postId),
      p.author_id === uid ? acceptedPlayers(postId) : Promise.resolve([]),
    ]);
    setPost(p);
    setData(tour);
    setAccepted(acc);
    setLoaded(true);
  }, [postId, uid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const { teams, matches } = data;
  const names = useMemo(() => Object.fromEntries(teams.map((tm) => [tm.id, tm.name])), [teams]);

  if (!loaded) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <EmptyState icon="calendar-outline" title={t('Event not found.')} />;
  if (data.missing) {
    return <EmptyState icon="construct-outline" title={t('Teams & matches are not available yet')} text={t('The app database needs an update first.')} />;
  }

  const isOrg = post.author_id === uid;
  const stage = post.tournament_stage ?? 'setup';
  const started = stage === 'running' || stage === 'finished';
  const myTeamId = teams.find((tm) => tm.members.some((m) => m.id === uid))?.id ?? null;
  const places = stage === 'finished' ? podium(post.format, teams, matches) : [];

  // ---- organizer actions ----
  async function run(key, fn) {
    setBusy(key);
    try { return await fn(); } finally { setBusy(null); }
  }

  async function doForm(size) {
    if (teams.length && !(await confirmAsync(t('Reshuffle the teams?'), t('Everyone gets a new random team.'), t('Reshuffle')))) return;
    const { data: k, error } = await run('form', () => formTeams(postId, size));
    if (error) return notify(t('Could not form the teams'), error.message);
    notify(t('Teams are ready'), t('{n} teams. Tap a player to move them.', { n: k }), { type: 'success' });
    load();
  }

  async function doStart(opts) {
    const playing = teams.filter((tm) => tm.members.length > 0);
    const { error } = await run('start', () => startTournament(postId, playing, opts));
    if (error) return notify(t('Could not create the matches'), error.message);
    notify(t('Matches are ready'), t('Players were told their team and the schedule.'), { type: 'success' });
    setView('matches');
    load();
  }

  async function doScore(m, a, b, winner) {
    const { error } = await run('score', () => reportScore(m.id, a, b, winner));
    if (error) return notify(t('Could not save the score'), error.message);
    setSheet(null);
    notify(t('Score saved'), '', { type: 'success' });
    load();
  }

  async function doClear(m) {
    const { error } = await run('score', () => clearScore(m.id));
    if (error) return notify(t('Could not clear the result'), error.message);
    setSheet(null);
    load();
  }

  async function doMove(player, teamId) {
    const { error } = await run('move', () => movePlayer(postId, player.id, teamId));
    if (error) return notify(t('Could not move the player'), error.message);
    setSheet(null);
    load();
  }

  async function doRename(team, name) {
    const { error } = await run('rename', () => renameTeam(team.id, name));
    if (error) return notify(t('Could not rename the team'), error.message);
    setSheet(null);
    load();
  }

  async function doReset() {
    const ok = await confirmAsync(t('Start over?'), t('All matches and scores are deleted. The teams stay.'), t('Start over'), { destructive: true });
    if (!ok) return;
    const { error } = await run('reset', () => resetTournament(postId));
    if (error) return notify(t('Could not start over'), error.message);
    load();
  }

  async function doAward() {
    const { data: n, error } = await run('award', () => awardTopTeams(postId));
    if (error) return notify(t('Could not give the medals'), error.message);
    notify(
      t('Medals given'),
      n ? t('{n} players got a medal.', { n }) : t('Everyone on the podium already has a medal.'),
      { type: 'success' },
    );
  }

  const openPlayer = isOrg ? (player, team) => setSheet({ kind: 'player', player, teamId: team?.id ?? null }) : null;
  const openRename = isOrg ? (team) => setSheet({ kind: 'rename', team }) : null;
  const openScore = isOrg ? (m) => setSheet({ kind: 'score', match: m }) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.event} numberOfLines={2}>{post.title}</Text>
        <Text style={styles.sub}>
          {[started ? formatTitle(post.format) : null, teams.length ? t('{n} teams', { n: teams.length }) : null]
            .filter(Boolean).join(' · ') || t('Team event')}
        </Text>
        {isOrg ? <Steps current={STEP_OF[stage] ?? 0} /> : null}

        {isOrg && !started ? (
          <FadeIn style={{ flex: 0 }}>
            <TeamsSetup
              post={post} accepted={accepted} teams={teams} busy={busy === 'form'} router={router}
              onForm={doForm} onPlayer={openPlayer} onRename={openRename}
            />
            {teams.length >= 2 ? <StartCard post={post} teams={teams} busy={busy === 'start'} onStart={doStart} /> : null}
          </FadeIn>
        ) : started ? (
          <>
            {places.length ? <Podium places={places} names={names} myTeamId={myTeamId} /> : null}
            {isOrg && stage === 'finished' ? (
              <View style={styles.medalBox}>
                <Button title={t('Give medals to top 3 teams')} icon="medal-outline" loading={busy === 'award'} onPress={doAward} />
                <TouchableOpacity onPress={() => router.push(`/badge/${postId}`)} style={styles.linkRow}>
                  <Text style={styles.link}>{t('See all medals')}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.brand} />
                </TouchableOpacity>
              </View>
            ) : null}
            <Segmented
              tone="quiet"
              value={view}
              onChange={setView}
              style={{ marginBottom: 12 }}
              options={[
                { key: 'matches', label: t('Matches'), icon: 'trophy-outline' },
                { key: 'teams', label: t('Teams'), icon: 'people-outline' },
              ]}
            />
            {view === 'matches' ? (
              <MatchesView post={post} teams={teams} matches={matches} names={names} myTeamId={myTeamId} onMatch={openScore} />
            ) : (
              <TeamsList teams={teams} myTeamId={myTeamId} onPlayer={openPlayer} onRename={openRename} router={router} />
            )}
            {isOrg ? (
              <TouchableOpacity onPress={doReset} style={styles.resetRow} disabled={busy === 'reset'}>
                <Ionicons name="refresh-outline" size={14} color={colors.muted} />
                <Text style={styles.resetText}>{t('Start over')}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : teams.length ? (
          <>
            <Text style={styles.waiting}>{t('The organizer is still setting up the matches.')}</Text>
            <TeamsList teams={teams} myTeamId={myTeamId} router={router} />
          </>
        ) : (
          <EmptyState icon="people-outline" title={t('Teams are not ready yet')} text={t('The organizer makes the teams from the accepted players.')} />
        )}
      </ScrollView>

      {sheet?.kind === 'player' ? (
        <PlayerSheet
          player={sheet.player} teamId={sheet.teamId} teams={teams} busy={busy === 'move'}
          onMove={(teamId) => doMove(sheet.player, teamId)}
          onProfile={() => { setSheet(null); router.push(`/user/${sheet.player.id}`); }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.kind === 'rename' ? (
        <RenameSheet key={sheet.team.id} team={sheet.team} busy={busy === 'rename'} onSave={(name) => doRename(sheet.team, name)} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === 'score' ? (
        <ScoreSheet
          key={sheet.match.id} match={sheet.match} names={names} busy={busy === 'score'}
          onSave={(a, b, w) => doScore(sheet.match, a, b, w)} onClear={() => doClear(sheet.match)} onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}

/* ---------------- steps ---------------- */
function Steps({ current }) {
  return (
    <View style={styles.steps}>
      {STEPS.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <View key={s} style={styles.step}>
            <View style={[styles.stepDot, done && styles.stepDone, on && styles.stepOn]}>
              {done ? <Ionicons name="checkmark" size={12} color={colors.onBrand} />
                : <Text style={[styles.stepNum, on && { color: colors.onBrand }]}>{i + 1}</Text>}
            </View>
            <Text style={[styles.stepText, (on || done) && { color: colors.ink }]} numberOfLines={1}>{t(s)}</Text>
          </View>
        );
      })}
    </View>
  );
}

/* ---------------- step 1: teams ---------------- */
function TeamsSetup({ post, accepted, teams, busy, router, onForm, onPlayer, onRename }) {
  const [size, setSize] = useState(clamp(post.team_size ?? post.team_min ?? 4, 2, 20));
  const n = accepted.length;
  const placed = new Set(teams.flatMap((tm) => tm.members.map((m) => m.id)));
  const loose = accepted.filter((p) => !placed.has(p.id));

  if (n < 2 && !teams.length) {
    return (
      <Section>
        <EmptyState
          icon="people-outline"
          title={t('Accept at least 2 players first')}
          text={t('Students apply with one button. Accept them, then form the teams here.')}
          action={t('Review applicants')}
          onAction={() => router.push(`/applicants/${post.id}`)}
          style={{ paddingVertical: 20 }}
        />
      </Section>
    );
  }

  return (
    <>
      <Section title={t('Teams')} icon="people-outline">
        <Text style={styles.big}>{n === 1 ? t('1 accepted player') : t('{n} accepted players', { n })}</Text>
        <Stepper label={t('Players per team')} value={size} min={2} max={20} onChange={setSize} style={{ marginTop: 10 }} />
        {n >= 2 ? <Text style={styles.hint}>{t('That makes {k} teams.', { k: Math.max(2, Math.ceil(n / size)) })}</Text> : null}
        <Button
          title={teams.length ? t('Reshuffle teams') : t('Form teams')}
          icon="shuffle-outline"
          variant={teams.length ? 'ghost' : 'primary'}
          loading={busy}
          disabled={n < 2}
          onPress={() => onForm(size)}
          style={{ marginTop: 12 }}
        />
      </Section>

      {loose.length > 0 && teams.length > 0 ? (
        <Section title={t('Not on a team yet')} icon="person-add-outline">
          <View style={styles.players}>
            {loose.map((p) => <PlayerChip key={p.id} player={p} onPress={() => onPlayer?.(p, null)} />)}
          </View>
        </Section>
      ) : null}

      {teams.length ? <TeamsList teams={teams} onPlayer={onPlayer} onRename={onRename} router={router} /> : null}
      {teams.length ? <Text style={styles.tip}>{t('Tap a player to move them. Tap a team name to rename it.')}</Text> : null}
    </>
  );
}

function PlayerChip({ player, onPress, mine }) {
  return (
    <TouchableOpacity style={[styles.player, mine && styles.playerMine]} onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      <Avatar uri={player.avatar_url} id={player.id} name={player.full_name} size={24} />
      <Text style={styles.playerName} numberOfLines={1}>{player.full_name ?? t('Player')}</Text>
    </TouchableOpacity>
  );
}

function TeamsList({ teams, myTeamId, onPlayer, onRename, router }) {
  return teams.map((tm) => (
    <View key={tm.id} style={[styles.team, tm.id === myTeamId && styles.teamMine]}>
      <TouchableOpacity style={styles.teamHead} disabled={!onRename} onPress={() => onRename?.(tm)} accessibilityRole={onRename ? 'button' : undefined}>
        <Text style={styles.teamName} numberOfLines={1}>{tm.name}</Text>
        {onRename ? <Ionicons name="pencil-outline" size={13} color={colors.faint} /> : null}
        {tm.id === myTeamId ? <Text style={styles.youTag}>{t('Your team')}</Text> : null}
        <View style={{ flex: 1 }} />
        <Text style={styles.teamCount}>{tm.members.length}</Text>
        <Ionicons name="person-outline" size={12} color={colors.muted} />
      </TouchableOpacity>
      <View style={styles.players}>
        {tm.members.length ? tm.members.map((m) => (
          <PlayerChip key={m.id} player={m} onPress={() => (onPlayer ? onPlayer(m, tm) : router.push(`/user/${m.id}`))} />
        )) : <Text style={styles.hint}>{t('No players')}</Text>}
      </View>
    </View>
  ));
}

/* ---------------- step 2: start ---------------- */
function StartCard({ post, teams, busy, onStart }) {
  const n = teams.filter((tm) => tm.members.length > 0).length;
  const [format, setFormat] = useState(post.format && post.format !== 'none' ? post.format : (n === 2 ? 'versus' : 'playoff'));
  const [groups, setGroups] = useState(clamp(post.group_count ?? (n >= 6 ? 2 : 1), 1, 16));
  const [advance, setAdvance] = useState(clamp(post.advance_per_group ?? 2, 1, 8));
  const problem = scheduleProblem(n, format, groups, advance);
  let count = 0;
  if (!problem) {
    try { count = generateSchedule({ teams: teams.filter((tm) => tm.members.length), format, groupCount: groups, advance }).matches.length; } catch { count = 0; }
  }
  const withGroups = format === 'groups' || format === 'hybrid';

  return (
    <Section title={t('Start')} icon="play-outline">
      <FormatPicker value={format} onChange={setFormat} />
      {withGroups ? (
        <Stepper label={t('Groups')} value={groups} min={1} max={Math.max(1, Math.floor(n / 2))} onChange={setGroups} style={{ marginTop: 14 }} />
      ) : null}
      {format === 'hybrid' ? (
        <Stepper label={t('Teams going through from each group')} value={advance} min={1}
          max={Math.max(1, Math.min(8, Math.floor(n / Math.max(1, groups))))} onChange={setAdvance} style={{ marginTop: 10 }} />
      ) : null}
      {problem
        ? <Text style={styles.problem}>{t(problem[0], problem[1] ?? undefined)}</Text>
        : <Text style={styles.hint}>{count === 1 ? t('1 match') : t('{n} matches', { n: count })}</Text>}
      <Button title={t('Create matches')} icon="play" disabled={!!problem} loading={busy}
        onPress={() => onStart({ format, groupCount: groups, advance })} style={{ marginTop: 12 }} />
    </Section>
  );
}

/* ---------------- step 3: matches ---------------- */
function MatchesView({ post, teams, matches, names, myTeamId, onMatch }) {
  const tables = computeStandings(teams, matches);
  const groupNos = Object.keys(tables).map(Number).sort((a, b) => a - b);
  const cols = bracketRounds(matches);
  const advance = post.format === 'hybrid' ? post.advance_per_group ?? 0 : 0;

  if (!matches.length) return <EmptyState icon="trophy-outline" title={t('No matches yet')} />;
  return (
    <>
      {groupNos.map((g) => (
        <Section key={g} title={groupNos.length > 1 ? t('Group {g}', { g: groupLetter(g) }) : t('Table')} icon="grid-outline">
          <Standings rows={tables[g]} names={names} myTeamId={myTeamId} advance={advance} />
          <View style={{ marginTop: 10 }}>
            {matches.filter((m) => m.stage === 'group' && m.group_no === g)
              .sort((a, b) => a.round - b.round || a.slot - b.slot)
              .map((m) => <MatchRow key={m.id} m={m} names={names} myTeamId={myTeamId} onPress={onMatch} />)}
          </View>
        </Section>
      ))}
      {cols.length ? (
        <Section title={post.format === 'versus' ? t('Match') : t('Playoff')} icon="git-network-outline">
          <Bracket cols={cols} names={names} myTeamId={myTeamId} onMatch={onMatch} />
        </Section>
      ) : null}
    </>
  );
}

function Standings({ rows, names, myTeamId, advance }) {
  const head = ['P', 'W', 'D', 'L', 'GD', 'Pts'];
  return (
    <View>
      <View style={styles.tRow}>
        <Text style={[styles.tPos, styles.tHead]}>#</Text>
        <Text style={[styles.tTeam, styles.tHead]}>{t('Team')}</Text>
        {head.map((h) => <Text key={h} style={[styles.tNum, styles.tHead]}>{t(h)}</Text>)}
      </View>
      {rows.map((r) => {
        const mine = r.team_id === myTeamId;
        const through = advance && r.rank <= advance;
        return (
          <View key={r.team_id} style={[styles.tRow, styles.tBody, mine && { backgroundColor: colors.brandSoft }]}>
            <Text style={[styles.tPos, through && { color: colors.brand, fontWeight: '800' }]}>{r.rank}</Text>
            <Text style={[styles.tTeam, mine && { fontWeight: '800' }]} numberOfLines={1}>{names[r.team_id] ?? t('Team')}</Text>
            {[r.played, r.won, r.drawn, r.lost, r.gd > 0 ? `+${r.gd}` : r.gd, r.pts].map((v, i) => (
              <Text key={head[i]} style={[styles.tNum, i === 5 && { fontWeight: '800', color: colors.ink }]}>{v}</Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function MatchRow({ m, names, myTeamId, onPress }) {
  const done = m.status === 'done';
  const nm = (id) => names[id] ?? t('Team');
  const style = (id) => [styles.mTeam, id === myTeamId && { fontWeight: '800', color: colors.ink }, done && m.winner === id && { color: colors.brand, fontWeight: '800' }];
  return (
    <TouchableOpacity style={styles.mRow} disabled={!onPress} onPress={() => onPress?.(m)} activeOpacity={0.8}>
      <Text style={[...style(m.team_a), { textAlign: 'right' }]} numberOfLines={1}>{nm(m.team_a)}</Text>
      <View style={[styles.mScore, done && styles.mScoreDone]}>
        <Text style={[styles.mScoreText, done && { color: colors.ink }]}>{done ? `${m.score_a} : ${m.score_b}` : '–'}</Text>
      </View>
      <Text style={style(m.team_b)} numberOfLines={1}>{nm(m.team_b)}</Text>
    </TouchableOpacity>
  );
}

const CARD_H = 66;
const CARD_GAP = 14;

function Bracket({ cols, names, myTeamId, onMatch }) {
  const total = cols[cols.length - 1].round;
  const height = 2 ** (total - 1) * (CARD_H + CARD_GAP);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      {Array.from({ length: total }, (_, i) => i + 1).map((r) => {
        const col = cols.find((c) => c.round === r)?.matches ?? [];
        const [label, vars] = roundName(r, total);
        return (
          <View key={r} style={{ width: 170 }}>
            <Text style={styles.roundLabel}>{t(label, vars ?? undefined)}</Text>
            <View style={{ height, justifyContent: 'space-around' }}>
              {Array.from({ length: 2 ** (total - r) }, (_, s) => {
                const m = col.find((x) => x.slot === s + 1);
                return m
                  ? <BracketMatch key={m.id} m={m} names={names} myTeamId={myTeamId} onMatch={onMatch} />
                  : <View key={`bye-${s}`} style={styles.bye}><Text style={styles.byeText}>{t('Bye')}</Text></View>;
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function slotLabel(m, side) {
  const id = m[`team_${side}`];
  if (id) return null;
  const src = parseSrc(m[`src_${side}`]);
  return src ? t('Group {g} · #{n}', { g: groupLetter(src.group), n: src.pos }) : t('TBD');
}

function BracketMatch({ m, names, myTeamId, onMatch }) {
  const done = m.status === 'done';
  const tappable = !!onMatch && m.team_a && m.team_b;
  const side = (s) => {
    const id = m[`team_${s}`];
    const win = done && m.winner && m.winner === id;
    return (
      <View style={[styles.bSide, win && styles.bWin]}>
        <Text
          style={[styles.bName, !id && styles.bTbd, id === myTeamId && { fontWeight: '800' }, win && styles.bWinText]}
          numberOfLines={1}
        >
          {id ? names[id] ?? t('Team') : slotLabel(m, s)}
        </Text>
        <Text style={[styles.bScore, win && styles.bWinText]}>{done ? m[`score_${s}`] : ''}</Text>
      </View>
    );
  };
  return (
    <TouchableOpacity disabled={!tappable} onPress={() => onMatch?.(m)} activeOpacity={0.85}
      style={[styles.bCard, !tappable && !done && { opacity: 0.85 }]} accessibilityRole={tappable ? 'button' : undefined}>
      {side('a')}
      <View style={styles.bDivider} />
      {side('b')}
    </TouchableOpacity>
  );
}

/* ---------------- step 4: podium ---------------- */
function Podium({ places, names, myTeamId }) {
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return (
    <FadeIn style={{ flex: 0 }}>
      <View style={styles.podium}>
        {places.map((p) => (
          <View key={`${p.place}-${p.team_id}`} style={styles.podiumRow}>
            <Text style={styles.podiumMedal}>{medal[p.place]}</Text>
            <Text style={[styles.podiumName, p.place === 1 && { fontSize: 18 }, p.team_id === myTeamId && { color: colors.brand }]} numberOfLines={1}>
              {names[p.team_id] ?? t('Team')}
            </Text>
          </View>
        ))}
      </View>
    </FadeIn>
  );
}

/* ---------------- sheets ---------------- */
function Sheet({ title, onClose, children }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalWrap} activeOpacity={1} onPress={onClose}>
        {/* Taps inside the card don't reach the backdrop (which closes). */}
        <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
          <View style={styles.sheetHead}>
            <Text style={[type.h2, { flex: 1 }]} numberOfLines={2}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('Close')}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function PlayerSheet({ player, teamId, teams, busy, onMove, onProfile, onClose }) {
  return (
    <Sheet title={player.full_name ?? t('Player')} onClose={onClose}>
      <Text style={styles.sheetLabel}>{t('Move to')}</Text>
      <View style={styles.players}>
        {teams.map((tm) => (
          <Chip key={tm.id} text={tm.name} on={tm.id === teamId} onPress={() => tm.id !== teamId && !busy && onMove(tm.id)} />
        ))}
      </View>
      {teamId ? (
        <Button title={t('Take off the team')} icon="remove-circle-outline" variant="ghost" size="sm" style={{ marginTop: 16 }} disabled={busy} onPress={() => onMove(null)} />
      ) : null}
      <TouchableOpacity onPress={onProfile} style={[styles.linkRow, { alignSelf: 'center' }]}>
        <Text style={styles.link}>{t('View profile')}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.brand} />
      </TouchableOpacity>
    </Sheet>
  );
}

function RenameSheet({ team, busy, onSave, onClose }) {
  const [name, setName] = useState(team.name);
  return (
    <Sheet title={t('Rename team')} onClose={onClose}>
      <TextField value={name} onChangeText={setName} maxLength={40} autoFocus placeholder="Falcons" onSubmitEditing={() => onSave(name)} />
      <Button title={t('Save')} icon="checkmark" loading={busy} disabled={!name.trim()} onPress={() => onSave(name)} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

function ScoreSheet({ match, names, busy, onSave, onClear, onClose }) {
  const [a, setA] = useState(match.score_a != null ? String(match.score_a) : '');
  const [b, setB] = useState(match.score_b != null ? String(match.score_b) : '');
  const [winner, setWinner] = useState(match.winner ?? null);
  const digits = (v) => v.replace(/[^0-9]/g, '').slice(0, 3);
  const filled = a !== '' && b !== '';
  const level = filled && Number(a) === Number(b);
  const needWinner = match.stage === 'playoff' && level;
  const ok = filled && (!needWinner || winner === match.team_a || winner === match.team_b);
  const nameA = names[match.team_a] ?? t('Team');
  const nameB = names[match.team_b] ?? t('Team');

  return (
    <Sheet title={t('Score')} onClose={onClose}>
      <View style={styles.scoreRow}>
        <Text style={[styles.scoreName, { textAlign: 'right' }]} numberOfLines={2}>{nameA}</Text>
        <TextInput style={styles.scoreInput} value={a} onChangeText={(v) => setA(digits(v))} keyboardType="number-pad" placeholder="0"
          placeholderTextColor={colors.faint} accessibilityLabel={nameA} autoFocus />
        <Text style={styles.scoreColon}>:</Text>
        <TextInput style={styles.scoreInput} value={b} onChangeText={(v) => setB(digits(v))} keyboardType="number-pad" placeholder="0"
          placeholderTextColor={colors.faint} accessibilityLabel={nameB} />
        <Text style={styles.scoreName} numberOfLines={2}>{nameB}</Text>
      </View>
      {needWinner ? (
        <>
          <Text style={styles.sheetLabel}>{t('Level score — who won (penalties, tie-break)?')}</Text>
          <View style={styles.players}>
            <Chip text={nameA} on={winner === match.team_a} onPress={() => setWinner(match.team_a)} />
            <Chip text={nameB} on={winner === match.team_b} onPress={() => setWinner(match.team_b)} />
          </View>
        </>
      ) : null}
      <Button title={t('Save score')} icon="checkmark" loading={busy} disabled={!ok}
        onPress={() => onSave(Number(a), Number(b), needWinner ? winner : null)} style={{ marginTop: 16 }} />
      {match.status === 'done' ? (
        <TouchableOpacity onPress={onClear} style={[styles.linkRow, { alignSelf: 'center' }]} disabled={busy}>
          <Text style={[styles.link, { color: colors.muted }]}>{t('Clear result')}</Text>
        </TouchableOpacity>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 60, ...column },
  event: { ...type.h1, fontSize: 22, lineHeight: 28 },
  sub: { ...type.small, marginTop: 2, marginBottom: 12 },
  big: { ...type.title },
  hint: { ...type.small, fontSize: 12.5, marginTop: 8 },
  tip: { ...type.small, fontSize: 12.5, textAlign: 'center', marginTop: 2, marginBottom: 12 },
  problem: { fontSize: 13, color: colors.warn, fontWeight: '600', marginTop: 12 },
  waiting: { ...type.small, textAlign: 'center', marginBottom: 12 },
  steps: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14, gap: 6 },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  stepOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  stepDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  stepNum: { fontSize: 11, fontWeight: '800', color: colors.muted },
  stepText: { fontSize: 11.5, fontWeight: '600', color: colors.muted },
  players: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  player: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%',
    backgroundColor: colors.bg, borderRadius: radius.pill, paddingVertical: 3, paddingLeft: 3, paddingRight: 10,
  },
  playerMine: { backgroundColor: colors.brandSoft },
  playerName: { fontSize: 13, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  team: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, marginBottom: 10 },
  teamMine: { borderColor: colors.brand },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  teamName: { fontSize: 15, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  teamCount: { fontSize: 12.5, color: colors.muted, fontWeight: '700' },
  youTag: { fontSize: 11, fontWeight: '700', color: colors.brand, backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6 },
  tBody: { borderTopWidth: 1, borderTopColor: colors.line },
  tHead: { fontSize: 11, fontWeight: '700', color: colors.muted },
  tPos: { width: 20, fontSize: 12.5, color: colors.muted, fontWeight: '700' },
  tTeam: { flex: 1, fontSize: 13.5, color: colors.ink, fontWeight: '600' },
  tNum: { width: 28, textAlign: 'center', fontSize: 12.5, color: colors.body },
  mRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  mTeam: { flex: 1, fontSize: 13.5, color: colors.body, fontWeight: '600' },
  mScore: { minWidth: 58, alignItems: 'center', borderRadius: radius.sm, paddingVertical: 4, backgroundColor: colors.bg },
  mScoreDone: { backgroundColor: colors.brandSoft },
  mScoreText: { fontSize: 13.5, fontWeight: '800', color: colors.faint },
  roundLabel: { ...type.caption, textTransform: 'uppercase', marginBottom: 6 },
  bCard: { height: CARD_H, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden', ...shadow.sm },
  bSide: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  bWin: { backgroundColor: colors.brandSoft },
  bName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink },
  bTbd: { color: colors.faint, fontWeight: '500', fontStyle: 'italic' },
  bWinText: { color: colors.brand, fontWeight: '800' },
  bScore: { fontSize: 13, fontWeight: '800', color: colors.body, minWidth: 16, textAlign: 'right' },
  bDivider: { height: 1, backgroundColor: colors.line },
  bye: { height: CARD_H, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  byeText: { fontSize: 12, color: colors.faint },
  podium: { backgroundColor: colors.warnSoft, borderRadius: radius.lg, padding: 14, marginBottom: 12, gap: 6 },
  podiumRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  podiumMedal: { fontSize: 20 },
  podiumName: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.ink },
  medalBox: { marginBottom: 14 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 12, alignSelf: 'center', padding: 4 },
  link: { fontSize: 13.5, fontWeight: '700', color: colors.brand },
  resetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 18, padding: 6 },
  resetText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 20, maxWidth: 440, width: '100%', alignSelf: 'center', ...shadow.lg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  sheetLabel: { ...type.label, color: colors.muted, marginTop: 14, marginBottom: 8 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  scoreName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  scoreInput: {
    width: 56, height: 52, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, backgroundColor: colors.bg,
    textAlign: 'center', fontSize: 22, fontWeight: '800', color: colors.ink, outlineStyle: 'none',
  },
  scoreColon: { fontSize: 20, fontWeight: '800', color: colors.muted },
});
