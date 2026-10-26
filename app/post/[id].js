import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Linking, Image, Modal, Platform } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow, column, CATEGORIES, EVENT_LANGUAGES, typeMeta, awardMeta } from '../../lib/theme';
import { Button, Tag, Avatar, EmptyState, TextField, Section, reliabilityText } from '../../components/ui';
import { peek } from '../../lib/cache';
import { useReportSheet, fetchContactDetails } from '../../lib/moderation';
import { sendConnect } from '../../lib/social';
import { notify } from '../../lib/notify';
import { formatEventWhen } from '../../lib/events';
import {
  useSavedIds, toggleSaved, shareEvent, shareToTelegram, addToGoogleCalendar, downloadIcs,
  canAddToCalendar, hasPlace, openInMaps, seededPost,
} from '../../lib/discover';
import MapPreview from '../../components/MapPreview';
import Ticket from '../../components/Ticket';
import Stars from '../../components/Stars';
import { daysUntil, FriendsGoing } from '../../components/EventCard';
import { t, dateLocale } from '../../lib/i18n';
import { isTeamEvent, useMyTeam } from '../../lib/eventTeams';
import { formatTitle } from '../../components/FormatPicker';

const LANGUAGE_LABEL = Object.fromEntries(EVENT_LANGUAGES.map((l) => [l.key, l.label]));

// The event as a list already had it (tapped in the feed / Saved, or still in
// the feed cache), so the screen draws at once instead of a spinner.
function initialPost(id, uid) {
  const seeded = seededPost(id);
  if (seeded) return seeded;
  const hit = uid ? (peek(`feed:${uid}`)?.posts ?? []).find((x) => String(x.id) === String(id)) : null;
  return hit ? { ...hit, author: { id: hit.author_id, ...(hit.author ?? {}) } } : null;
}

export default function PostDetail() {
  const { id } = useLocalSearchParams();
  const { session, profile } = useAuth();
  const router = useRouter();
  const uid = session?.user?.id;
  const [post, setPost] = useState(() => initialPost(id, uid));
  const [application, setApplication] = useState(null);
  const [roster, setRoster] = useState([]);
  const [results, setResults] = useState([]);
  const [reviews, setReviews] = useState([]);
  // `loading`: nothing to show yet. `loaded`: the full fetch has answered —
  // until then a seeded screen holds back what depends on your application.
  const [loaded, setLoaded] = useState(false);
  const loading = !loaded && !post;
  const [applyOpen, setApplyOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  // Organizer's phone / Telegram / LinkedIn — only for people allowed to see
  // them (the organizer, and anyone who applied). See contact_details().
  const [contact, setContact] = useState(null);
  const safety = useReportSheet({ onBlocked: () => router.back() });
  const savedIds = useSavedIds();
  const insets = useSafeAreaInsets();
  // Team events: the student's team and next match (organizer-run teams).
  const myTeam = useMyTeam(id, uid, !!post && isTeamEvent(post) && (post.author?.id ?? post.author_id) !== uid);

  // Requests in parallel rather than one wait after another.
  const load = useCallback(async () => {
    // With the organizer known from the seed, their contact details come in
    // the same round instead of after it.
    const knownAuthor = seededPost(id)?.author_id ?? null;
    const [postRes, appRes, rosterRes, awRes, revRes, contactSeed] = await Promise.all([
      supabase
        .from('posts')
        .select('*, author:profiles!posts_author_id_fkey(id, full_name, reliability, avatar_url)')
        .eq('id', id)
        .single(),
      uid
        ? supabase.from('applications').select('*').eq('post_id', id).eq('applicant_id', uid).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc('event_roster', { p: id }),
      supabase
        .from('awards')
        .select('id, kind, place, note, recipient:profiles!awards_recipient_id_fkey(id, full_name)')
        .eq('post_id', id),
      // Without 29_growth.sql this errors and the section just stays hidden.
      supabase
        .from('event_reviews')
        .select('id, rating, comment, created_at, reviewer_id, reviewer:profiles!event_reviews_reviewer_id_fkey(id, full_name, avatar_url)')
        .eq('post_id', id)
        .order('created_at', { ascending: false }),
      knownAuthor ? fetchContactDetails(knownAuthor).catch(() => null) : Promise.resolve(undefined),
    ]);
    // A failed request (offline) keeps the seeded copy on screen; only a real
    // "no such row" (PGRST116) means the event is gone.
    setPost((prev) => postRes.data ?? (postRes.error && postRes.error.code !== 'PGRST116' ? prev : null));
    const authorId = postRes.data?.author?.id;
    setContact(!authorId ? null
      : authorId === knownAuthor && contactSeed !== undefined ? contactSeed
        : await fetchContactDetails(authorId));
    setApplication(appRes.data);
    setRoster(rosterRes.data ?? []);
    setResults(awRes.data ?? []);
    setReviews(revRes.error ? [] : (revRes.data ?? []));
    setLoaded(true);
  }, [id, uid]);

  useFocusEffect(useCallback(() => {
    load();
    // Counts toward the organizer's stats; never for their own visits.
    supabase.rpc('record_post_view', { p: id }).then(() => {}, () => {});
  }, [load, id]));

  const questions = Array.isArray(post?.questions) ? post.questions.filter((q) => q?.q) : [];

  async function apply(answers) {
    if (!post) return;
    if (post.author?.id === uid) return notify(t("That's your event"), t('You cannot apply to your own event.'));
    // Optimistic: the status flips immediately, then confirms with the server.
    setApplication({ post_id: post.id, applicant_id: uid, status: 'pending', optimistic: true });
    const row = { post_id: post.id, applicant_id: uid };
    if (answers) row.answers = answers;
    const { error } = await supabase.from('applications').insert(row);
    if (error) {
      setApplication(null);
      return notify(t('Could not apply'), error.message);
    }
    setApplyOpen(false);
    notify(t('Application sent'), t("The organizer will review your application. Once you're accepted, the event chat opens for you."));
    load();
  }

  // Report the event (reason picker) and/or block its organizer.
  function openSafety() {
    if (!post) return;
    safety.open({
      type: 'event',
      id: post.id,
      postId: post.id,
      userId: post.author?.id,
      name: post.author?.full_name ?? t('this organizer'),
    });
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <EmptyState icon="calendar-outline" title={t('Event not found')} text={t('It may have been removed by the organizer.')} />;

  const cat = CATEGORIES[post.kind] ?? CATEGORIES.event;
  const tm = typeMeta(post.category);
  const isOwner = (post.author?.id ?? post.author_id) === uid;
  const isFinished = post.status === 'completed';
  const accepted = roster.filter((r) => r.status === 'accepted');
  const canChat = isOwner || application?.status === 'accepted';
  const a = post.author ?? {};
  const c = contact ?? {};
  const hasContact = !!(c.telegram || c.phone || c.linkedin);
  const tg = String(c.telegram ?? '').replace(/^@/, '');
  const status = application ? statusMeta(application.status) : null;
  const isSaved = savedIds.has(post.id);
  const dayCame = isFinished || (daysUntil(post.event_date) ?? 1) <= 0;
  const myReview = reviews.find((r) => r.reviewer_id === uid);
  const canReview = application?.status === 'accepted' && dayCame && !myReview;
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const deadlineIn = daysUntil(post.deadline);
  const deadlinePassed = deadlineIn !== null && deadlineIn < 0;

  function onApplyPress() {
    if (questions.length) setApplyOpen(true);
    else apply(null);
  }
  // Same handler as the in-page Apply button. Team events too: students
  // apply alone and the organizer makes the teams.
  const applyAction = onApplyPress;
  const teamEvent = isTeamEvent(post);
  const canApplyNow = !status && !isFinished && !deadlinePassed;
  // Sticky bar: students only, once we know whether they already applied.
  const showBar = loaded && !isOwner && profile?.role !== 'organizer' && !!uid && (status || canApplyNow);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={[styles.page, showBar && { paddingBottom: 110 }]}>
      {isFinished && (
        <View style={styles.finished}>
          <Ionicons name="flag-outline" size={18} color={colors.body} />
          <View style={{ flex: 1 }}>
            <Text style={styles.finishedText}>{t('This event has finished')}</Text>
            <Text style={styles.finishedSub}>{t('It no longer accepts applications.')}</Text>
          </View>
        </View>
      )}

      <View style={styles.hero}>
        {post.cover_url ? (
          <View style={styles.coverWrap}>
            {/* "contain" so the whole poster is readable, never cropped */}
            <Image source={{ uri: post.cover_url }} style={styles.coverImg} resizeMode="contain" />
            {isFinished && <View style={styles.coverDim} />}
          </View>
        ) : (
          <View style={[styles.coverBand, { backgroundColor: isFinished ? '#6b6f68' : cat.color }]}>
            <Ionicons name={tm.icon} size={40} color="rgba(255,255,255,0.92)" />
          </View>
        )}

        <View style={styles.heroBody}>
          <Tag label={t(tm.key)} icon={tm.icon} color={colors.brand} soft={colors.brandSoft} />
          <Text style={styles.heroTitle}>{post.title}</Text>

          <View style={styles.facts}>
            {post.event_date ? <Fact icon="calendar-clear-outline" text={formatEventWhen(post.event_date, post.start_time)} /> : null}
            {post.is_online
              ? <Fact icon="laptop-outline" text={t('Online')} />
              : (post.location || post.city ? <Fact icon="location-outline" text={[post.location, post.city].filter(Boolean).join(', ')} /> : null)}
            {post.deadline ? (
              <Fact
                icon="hourglass-outline"
                tone={deadlineIn !== null && deadlineIn >= 0 && deadlineIn <= 3 ? 'warn' : null}
                text={deadlinePassed
                  ? t('Applications closed')
                  : t('Apply by {date}', { date: new Date(`${post.deadline}T00:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }) })}
              />
            ) : null}
            <Fact
              icon={teamEvent ? 'people-outline' : 'person-outline'}
              text={teamEvent
                ? [t('Team event · {n} per team', { n: post.team_size ?? post.team_min ?? 2 }), formatTitle(post.format)].filter(Boolean).join(' · ')
                : t('Individual applications')}
            />
            <Fact icon="pricetag-outline" text={post.is_free === false ? (post.fee || t('Paid')) : t('Free')} />
            {post.language ? <Fact icon="language-outline" text={t(LANGUAGE_LABEL[post.language] ?? post.language)} /> : null}
            {typeof post.spots === 'number' ? <Fact icon="ticket-outline" text={post.spots === 1 ? t('1 spot') : t('{n} spots', { n: post.spots })} /> : null}
          </View>

          {/* Save · Share · Telegram · Calendar */}
          <View style={styles.actions}>
            <Action icon={isSaved ? 'bookmark' : 'bookmark-outline'} label={isSaved ? t('Saved') : t('Save')} on={isSaved} onPress={() => toggleSaved(post.id)} />
            <Action icon="share-social-outline" label={t('Share')} onPress={() => shareEvent(post)} />
            <Action icon="paper-plane-outline" label="Telegram" onPress={() => shareToTelegram(post)} />
            {canAddToCalendar(post) ? (
              <Action icon="calendar-outline" label={t('Calendar')} onPress={() => (Platform.OS === 'web' ? setCalOpen(true) : addToGoogleCalendar(post))} />
            ) : null}
          </View>
        </View>
      </View>

      {/* Ticket for accepted participants */}
      {application?.status === 'accepted' && application.checkin_code && !isFinished ? (
        <Ticket postId={post.id} code={application.checkin_code} name={profile?.full_name} checkedIn={application.checked_in} />
      ) : null}

      {/* Who's in — avatar stack + counts + event chat. Hidden while nobody
          has applied ("0 applied · 0 accepted" only makes an event look dead),
          except for whoever has the event chat button in it. */}
      {(roster.length > 0 || canChat) && (
      <View style={styles.rosterRow}>
        <View style={styles.avatars}>
          {roster.slice(0, 4).map((r, i) => (
            <Avatar key={r.id} id={r.id} name={r.full_name} size={30} style={[styles.av, { marginLeft: i ? -9 : 0, zIndex: 10 - i }]} />
          ))}
        </View>
        <Text style={styles.rosterText}>
          {t('{n} applied', { n: roster.length })} · <Text style={{ color: colors.brand, fontWeight: '700' }}>{t('{n} accepted', { n: accepted.length })}</Text>
        </Text>
        {canChat && (
          <Button title={t('Event chat')} icon="chatbubbles-outline" size="sm" variant="dark" onPress={() => router.push(`/event-chat/${post.id}`)} />
        )}
      </View>
      )}
      <FriendsGoing postId={post.id} style={{ marginBottom: 10, marginHorizontal: 4 }} />
      {accepted.length > 0 && (
        <Text style={styles.going}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{t('Going:')} </Text>
          {accepted.map((r) => r.full_name).join(', ')}
        </Text>
      )}

      {myTeam?.team || myTeam?.hasMatches ? (
        <MyTeamCard info={myTeam} postId={post.id} router={router} />
      ) : null}

      {results.length > 0 && (() => {
        const winners = results.filter((x) => x.kind === 'winner').sort((x, y) => (x.place ?? 9) - (y.place ?? 9));
        const mentions = results.filter((x) => x.kind === 'mention');
        const others = results.length - winners.length - mentions.length;
        return (
          <Section title={t('Results')} icon="trophy-outline">
            {winners.map((x) => (
              <TouchableOpacity key={x.id} style={styles.resultRow} onPress={() => x.recipient?.id && router.push(`/user/${x.recipient.id}`)}>
                <Text style={styles.resultMedal}>{awardMeta(x).emoji}</Text>
                <Text style={styles.resultText}>
                  <Text style={{ fontWeight: '700' }}>{x.recipient?.full_name}</Text>
                  <Text style={{ color: colors.muted }}> · {t(awardMeta(x).label)}{x.note ? ` · “${x.note}”` : ''}</Text>
                </Text>
              </TouchableOpacity>
            ))}
            {mentions.map((x) => (
              <TouchableOpacity key={x.id} style={styles.resultRow} onPress={() => x.recipient?.id && router.push(`/user/${x.recipient.id}`)}>
                <Text style={styles.resultMedal}>🎖️</Text>
                <Text style={styles.resultText}>
                  <Text style={{ fontWeight: '700' }}>{x.recipient?.full_name}</Text>
                  <Text style={{ color: colors.muted }}> · {t('Honourable mention')}{x.note ? ` · “${x.note}”` : ''}</Text>
                </Text>
              </TouchableOpacity>
            ))}
            {others > 0 && <Text style={styles.resultDim}>{t('+ {n} more medals & participation awards', { n: others })}</Text>}
          </Section>
        );
      })()}

      <Section title={t('About')}>
        <Text style={styles.body}>{post.description || t('No description provided.')}</Text>
      </Section>

      {post.looking_for ? (
        <Section title={t("Who they're looking for")}>
          <Text style={styles.body}>{post.looking_for}</Text>
        </Section>
      ) : null}

      {!post.is_online && (hasPlace(post) || post.location) ? (
        <Section title={t('Location')} icon="map-outline">
          {hasPlace(post) ? <MapPreview lat={post.lat} lng={post.lng} /> : null}
          <TouchableOpacity style={styles.mapLink} onPress={() => openInMaps(post)}>
            <Ionicons name="navigate-outline" size={16} color={colors.brand} />
            <Text style={styles.mapLinkText} numberOfLines={2}>{post.location ?? t('Open in maps')}</Text>
            <Ionicons name="open-outline" size={15} color={colors.faint} />
          </TouchableOpacity>
        </Section>
      ) : null}

      {/* Organizer */}
      <TouchableOpacity
        style={styles.organizer}
        activeOpacity={0.85}
        disabled={!a.id}
        onPress={() => a.id && router.push(`/user/${a.id}`)}
      >
        <Avatar uri={a.avatar_url} id={a.id} name={a.full_name} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={styles.orgLabel}>{t('Organized by')}</Text>
          <Text style={styles.orgName} numberOfLines={1}>{a.full_name ?? t('Organizer')}</Text>
        </View>
        <View style={styles.reliability}>
          <Ionicons name="shield-checkmark" size={13} color={colors.brand} />
          <Text style={styles.reliabilityText}>{reliabilityText(a.reliability)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.faint} />
      </TouchableOpacity>

      {/* Reviews */}
      {(reviews.length > 0 || canReview) && (
        <Section title={t('Reviews')} icon="star-outline">
          {reviews.length > 0 && (
            <View style={styles.ratingRow}>
              <Text style={styles.ratingNum}>{avg.toFixed(1)}</Text>
              <View>
                <Stars value={avg} size={16} />
                <Text style={styles.ratingCount}>{reviews.length === 1 ? t('1 review') : t('{n} reviews', { n: reviews.length })}</Text>
              </View>
            </View>
          )}
          {canReview && (
            <Button title={t('Rate this event')} icon="star-outline" variant="soft" size="sm" style={{ marginTop: reviews.length ? 12 : 0 }} onPress={() => router.push(`/review/${post.id}`)} />
          )}
          {reviews.slice(0, 5).map((r) => (
            <View key={r.id} style={styles.review}>
              <Avatar uri={r.reviewer?.avatar_url} id={r.reviewer?.id} name={r.reviewer?.full_name} size={30} />
              <View style={{ flex: 1 }}>
                <View style={styles.reviewHead}>
                  <Text style={styles.reviewName} numberOfLines={1}>{r.reviewer?.full_name ?? t('Participant')}</Text>
                  <Stars value={r.rating} size={12} gap={1} />
                </View>
                {r.comment ? <Text style={styles.reviewText}>{r.comment}</Text> : null}
              </View>
            </View>
          ))}
        </Section>
      )}

      {hasContact && (
        <Section title={t('Contact the organizer')}>
          {c.telegram ? <ContactRow icon="paper-plane-outline" label={`@${tg}`} sub="Telegram" onPress={() => Linking.openURL(`https://t.me/${tg}`)} /> : null}
          {c.phone ? <ContactRow icon="call-outline" label={c.phone} sub={t('Phone')} onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}
          {c.linkedin ? <ContactRow icon="logo-linkedin" label={t('LinkedIn profile')} sub="LinkedIn" onPress={() => Linking.openURL(String(c.linkedin).startsWith('http') ? c.linkedin : `https://${c.linkedin}`)} last /> : null}
        </Section>
      )}
      {!hasContact && !isOwner && !application && !isFinished && (
        <Text style={styles.hint}>{t("The organizer's contact details are shown once you apply.")}</Text>
      )}

      {isOwner ? (
        <View style={{ marginTop: 6 }}>
          <Button title={t('Review applicants')} icon="document-text-outline" onPress={() => router.push(`/applicants/${post.id}`)} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Button title={t('Scan tickets')} icon="qr-code-outline" variant="ghost" style={{ flex: 1 }} onPress={() => router.push(`/scan/${post.id}`)} />
            <Button title={t('Stats')} icon="stats-chart-outline" variant="ghost" style={{ flex: 1 }} onPress={() => router.push(`/dashboard?post=${post.id}`)} />
          </View>
          {teamEvent && (
            <Button title={t('Teams & matches')} icon="trophy-outline" variant="soft" style={{ marginTop: 10 }} onPress={() => router.push(`/tournament/${post.id}`)} />
          )}
          <Button title={t('Edit event')} icon="create-outline" variant="ghost" style={{ marginTop: 10 }} onPress={() => router.push(`/event-edit/${post.id}`)} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Button title={t('Accepted')} icon="people-outline" variant="ghost" style={{ flex: 1 }} onPress={() => router.push(`/accepted/${post.id}`)} />
            <Button title={t('Medals')} icon="medal-outline" variant="ghost" style={{ flex: 1 }} onPress={() => router.push(`/badge/${post.id}`)} />
          </View>
          {!isFinished && (
            <Button title={t('End event & send feedback')} icon="flag-outline" variant="dark" style={{ marginTop: 10 }} onPress={() => router.push(`/end/${post.id}`)} />
          )}
          {!hasContact && (
            <Text style={styles.hint}>{t('Tip: add your Telegram or phone in your Passport so applicants can reach you.')}</Text>
          )}
          {hasContact && (
            <Text style={styles.hint}>{t('Your contact details are shown only to people who applied to your events.')}</Text>
          )}
        </View>
      ) : !loaded ? (
        <ActivityIndicator style={{ marginTop: 12 }} color={colors.brand} />
      ) : (
        <>
          {status ? (
            <View style={[styles.statusBox, { backgroundColor: status.soft }]}>
              <Ionicons name={status.icon} size={20} color={status.color} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusTitle, { color: status.color }]}>{status.title}</Text>
                <Text style={styles.statusSub}>{status.sub}</Text>
              </View>
            </View>
          ) : !isFinished && !deadlinePassed ? (
            <Button title={t('Apply now')} icon="arrow-forward" onPress={onApplyPress} style={{ marginTop: 6 }} />
          ) : null}

          <Button
            title={t('Connect with organizer')}
            icon="person-add-outline"
            variant="ghost"
            style={{ marginTop: 10 }}
            onPress={async () => {
              // sendConnect already words its errors ("You are already friends",
              // "They already sent you a request…", network errors) — show them
              // instead of calling every failure "Already sent".
              const { error } = await sendConnect(a.id);
              if (error) return notify(t('Could not send the request'), error.message);
              notify(t('Request sent'), t('They can accept you from their Portal → Requests.'));
            }}
          />

          <TouchableOpacity onPress={openSafety} style={styles.report}>
            <Ionicons name="flag-outline" size={13} color={colors.muted} />
            <Text style={styles.reportLink}>{t('Report event or block organizer')}</Text>
          </TouchableOpacity>
        </>
      )}
      {safety.sheet}

      <ApplySheet open={applyOpen} questions={questions} onClose={() => setApplyOpen(false)} onSubmit={apply} />

      {/* Web: pick which calendar. Phones go straight to Google Calendar. */}
      <Modal visible={calOpen} transparent animationType="fade" onRequestClose={() => setCalOpen(false)}>
        <TouchableOpacity style={styles.modalWrap} activeOpacity={1} onPress={() => setCalOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={type.h2}>{t('Add to calendar')}</Text>
            <Button title="Google Calendar" icon="logo-google" variant="ghost" style={{ marginTop: 16 }} onPress={() => { setCalOpen(false); addToGoogleCalendar(post); }} />
            <Button title={t('Apple / Outlook (.ics file)')} icon="download-outline" variant="ghost" style={{ marginTop: 10 }} onPress={() => { setCalOpen(false); downloadIcs(post); }} />
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>

    {showBar ? (
      <View style={[styles.bar, { paddingBottom: 14 + (insets.bottom || 0) }]}>
        <View style={styles.barInner}>
          {status ? (
            <View style={[styles.barStatus, { backgroundColor: status.soft }]}>
              <Ionicons name={status.icon} size={18} color={status.color} />
              <Text style={[styles.barStatusText, { color: status.color }]} numberOfLines={1}>{status.title}</Text>
            </View>
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <Text style={styles.barTitle} numberOfLines={1}>{post.title}</Text>
                {post.deadline ? (
                  <Text style={styles.barSub} numberOfLines={1}>
                    {t('Apply by {date}', { date: new Date(`${post.deadline}T00:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }) })}
                  </Text>
                ) : null}
              </View>
              <Button
                title={t('Apply now')}
                icon="arrow-forward"
                onPress={applyAction}
                style={{ paddingHorizontal: 20 }}
              />
            </>
          )}
        </View>
      </View>
    ) : null}
    </View>
  );
}

// "Your team: Falcons" + teammates + next match, and the way to the bracket.
function MyTeamCard({ info, postId, router }) {
  const { team, names, next, last, hasMatches } = info;
  const name = (id) => (id ? names[id] ?? t('Team') : t('TBD'));
  let line = null;
  if (next) line = `${t('Next match')}: ${name(next.team_a)} – ${name(next.team_b)}`;
  else if (last) {
    const won = last.winner === team?.id;
    const draw = !last.winner;
    line = `${draw ? t('Last match: draw') : won ? t('Last match: won') : t('Last match: lost')} ${last.score_a}–${last.score_b}`;
  }
  return (
    <View style={styles.teamCard}>
      {team ? (
        <>
          <View style={styles.teamHead}>
            <View style={styles.factIcon}><Ionicons name="people" size={15} color={colors.brand} /></View>
            <Text style={styles.teamName} numberOfLines={1}>
              <Text style={styles.teamLabel}>{t('Your team')}: </Text>{team.name}
            </Text>
          </View>
          <View style={styles.mates}>
            {team.members.map((m) => (
              <TouchableOpacity key={m.id} onPress={() => router.push(`/user/${m.id}`)} accessibilityLabel={m.full_name} style={styles.mate}>
                <Avatar uri={m.avatar_url} id={m.id} name={m.full_name} size={34} />
                <Text style={styles.mateName} numberOfLines={1}>{String(m.full_name ?? '').split(' ')[0]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {line ? <Text style={styles.teamLine}>{line}</Text> : null}
        </>
      ) : null}
      {hasMatches ? (
        <TouchableOpacity style={[styles.mapLink, !team && { marginTop: 0 }]} onPress={() => router.push(`/tournament/${postId}`)} accessibilityRole="link">
          <Ionicons name="trophy-outline" size={16} color={colors.brand} />
          <Text style={styles.mapLinkText}>{t('See bracket & standings')}</Text>
          <Ionicons name="chevron-forward" size={15} color={colors.faint} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Custom questions the organizer added to the form.
function ApplySheet({ open, questions, onClose, onSubmit }) {
  const [answers, setAnswers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function send() {
    const clean = questions.map((_, i) => String(answers[i] ?? '').trim());
    const missing = questions.findIndex((q, i) => q.required && !clean[i]);
    if (missing >= 0) { setErr(t('Please answer: {q}', { q: questions[missing].q })); return; }
    setErr('');
    setBusy(true);
    await onSubmit(clean.map((x) => x.slice(0, 1500)));
    setBusy(false);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={type.h2}>{t('Your application')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('Close')}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
            {questions.map((q, i) => (
              <TextField
                key={i}
                label={`${q.q}${q.required ? ' *' : ''}`}
                value={answers[i] ?? ''}
                onChangeText={(v) => setAnswers((xs) => { const n = [...xs]; n[i] = v; return n; })}
                multiline
                inputStyle={{ minHeight: 80, textAlignVertical: 'top' }}
                placeholder={t('Your answer')}
              />
            ))}
          </ScrollView>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Button title={t('Send application')} icon="send" loading={busy} onPress={send} style={{ marginTop: 16 }} />
        </View>
      </View>
    </Modal>
  );
}

const statusMeta = (s) =>
  s === 'accepted'
    ? { icon: 'checkmark-circle', title: t("You're in!"), sub: t('Your ticket is above. Open the event chat to meet the others.'), color: colors.accent, soft: colors.accentSoft }
    : s === 'rejected'
      ? { icon: 'close-circle', title: t('Not selected this time'), sub: t('Keep going: there are more events in the feed.'), color: colors.danger, soft: colors.dangerSoft }
      : { icon: 'time', title: t('Application sent'), sub: t('The organizer will review it soon.'), color: colors.warn, soft: colors.warnSoft };

function Fact({ icon, text, tone }) {
  const warn = tone === 'warn';
  return (
    <View style={styles.fact}>
      <View style={[styles.factIcon, warn && { backgroundColor: colors.warnSoft }]}>
        <Ionicons name={icon} size={15} color={warn ? colors.warn : colors.brand} />
      </View>
      <Text style={[styles.factText, warn && { color: colors.warn, fontWeight: '700' }]}>{text}</Text>
    </View>
  );
}
function Action({ icon, label, onPress, on }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.actionIcon, on && { backgroundColor: colors.brand }]}>
        <Ionicons name={icon} size={19} color={on ? colors.onBrand : colors.brand} />
      </View>
      <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}
function ContactRow({ icon, label, sub, onPress, last }) {
  return (
    <TouchableOpacity style={[styles.contact, last && { borderBottomWidth: 0 }]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.factIcon}><Ionicons name={icon} size={16} color={colors.brand} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.contactText}>{label}</Text>
        <Text style={styles.contactSub}>{sub}</Text>
      </View>
      <Ionicons name="open-outline" size={16} color={colors.faint} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48, ...column },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, ...shadow.lg,
  },
  barInner: { ...column, flexDirection: 'row', alignItems: 'center', gap: 12 },
  barTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  barSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  barStatus: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.md, paddingVertical: 13 },
  barStatusText: { fontSize: 14.5, fontWeight: '700' },
  finished: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, padding: 14, marginBottom: 12 },
  finishedText: { color: colors.ink, fontSize: 14.5, fontWeight: '700' },
  finishedSub: { color: colors.muted, fontSize: 12.5, marginTop: 2 },
  hero: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginBottom: 12, ...shadow.sm },
  coverWrap: { backgroundColor: '#14181a' },
  coverImg: { width: '100%', height: 360 },
  coverDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  coverBand: { height: 120, alignItems: 'center', justifyContent: 'center' },
  heroBody: { padding: 18 },
  heroTitle: { ...type.h1, fontSize: 22, lineHeight: 28, marginTop: 10 },
  facts: { marginTop: 14, gap: 10 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  factText: { flex: 1, fontSize: 14, color: colors.body, fontWeight: '500' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line },
  action: { alignItems: 'center', gap: 6, minWidth: 64 },
  actionIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 12, fontWeight: '600', color: colors.body },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, marginBottom: 8 },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  av: { borderWidth: 2, borderColor: colors.card },
  avEmpty: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  rosterText: { flex: 1, fontSize: 13, color: colors.muted, fontWeight: '600' },
  going: { fontSize: 12.5, color: colors.muted, marginBottom: 12, marginHorizontal: 4, lineHeight: 18 },
  body: { ...type.body },
  teamCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginBottom: 12 },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamLabel: { color: colors.muted, fontWeight: '600' },
  teamName: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  mates: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  mate: { alignItems: 'center', width: 52, gap: 4 },
  mateName: { fontSize: 11.5, color: colors.body, maxWidth: 52 },
  teamLine: { fontSize: 13.5, color: colors.body, fontWeight: '600', marginTop: 12 },
  resultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  resultMedal: { fontSize: 18, lineHeight: 22 },
  resultText: { flex: 1, fontSize: 14, color: colors.ink, lineHeight: 21 },
  resultDim: { fontSize: 12.5, color: colors.muted, marginTop: 8 },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  mapLinkText: { flex: 1, fontSize: 14, color: colors.brand, fontWeight: '600' },
  organizer: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginBottom: 12 },
  orgLabel: { fontSize: 12, color: colors.muted },
  orgName: { fontSize: 15.5, fontWeight: '700', color: colors.ink, marginTop: 1 },
  reliability: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 9 },
  reliabilityText: { fontSize: 12, fontWeight: '700', color: colors.brand },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ratingNum: { fontSize: 32, fontWeight: '800', color: colors.ink, letterSpacing: -1 },
  ratingCount: { fontSize: 12.5, color: colors.muted, marginTop: 3 },
  review: { flexDirection: 'row', gap: 10, paddingTop: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  reviewName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.ink },
  reviewText: { fontSize: 13.5, color: colors.body, marginTop: 4, lineHeight: 19 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  contactText: { fontSize: 14.5, color: colors.ink, fontWeight: '600' },
  contactSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  statusBox: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, padding: 14, marginTop: 6 },
  statusTitle: { fontSize: 15, fontWeight: '700' },
  statusSub: { fontSize: 13, color: colors.body, marginTop: 2 },
  hint: { fontSize: 12.5, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  report: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20, paddingVertical: 6 },
  reportLink: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 20, maxWidth: 420, width: '100%', alignSelf: 'center', ...shadow.lg },
  sheetWrap: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 34, width: '100%', maxWidth: 620, alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  err: { color: colors.danger, fontSize: 13.5, marginTop: 12 },
});
