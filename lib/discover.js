// Finding events and keeping hold of them: saved events, sharing, calendar,
// maps and the "For you" ranking. Needs supabase/29_growth.sql; without it
// saving quietly does nothing and the rest still works.
import { useEffect, useState } from 'react';
import { Platform, Share, Linking } from 'react-native';
import { supabase } from './supabase';
import { notify } from './notify';
import { t } from './i18n';
import { formatEventWhen } from './events';

export const PUBLIC_URL = 'https://tadbirly.expo.app';
export const eventUrl = (id) => `${PUBLIC_URL}/post/${id}`;

// ---------------------------------------------------------------------------
//  Saved events — one shared set for every screen, like the blocked list.
// ---------------------------------------------------------------------------
let saved = { me: null, ids: new Set(), loaded: false };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(saved.ids); } catch { /* ignore */ } });

async function me() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function loadSaved(force = false) {
  const uid = await me();
  if (!uid) return new Set();
  if (!force && saved.loaded && saved.me === uid) return saved.ids;
  const { data, error } = await supabase.from('saved_posts').select('post_id').eq('user_id', uid);
  if (error) return saved.ids;
  saved = { me: uid, ids: new Set((data ?? []).map((r) => r.post_id)), loaded: true };
  emit();
  return saved.ids;
}

export function useSavedIds() {
  const [ids, setIds] = useState(saved.ids);
  useEffect(() => {
    let alive = true;
    const fn = (next) => { if (alive) setIds(new Set(next)); };
    listeners.add(fn);
    loadSaved().then((s) => { if (alive) setIds(new Set(s)); });
    return () => { alive = false; listeners.delete(fn); };
  }, []);
  return ids;
}

// Optimistic: the bookmark flips at once and flips back if the save fails.
export async function toggleSaved(postId) {
  const uid = await me();
  if (!uid || !postId) return;
  const was = saved.ids.has(postId);
  const next = new Set(saved.ids);
  if (was) next.delete(postId); else next.add(postId);
  saved = { ...saved, me: uid, ids: next };
  emit();
  const { error } = was
    ? await supabase.from('saved_posts').delete().eq('user_id', uid).eq('post_id', postId)
    : await supabase.from('saved_posts').insert({ user_id: uid, post_id: postId });
  if (error && error.code !== '23505') {
    const back = new Set(saved.ids);
    if (was) back.add(postId); else back.delete(postId);
    saved = { ...saved, ids: back };
    emit();
    notify(t('Could not save'), error.code === '42P01'
      ? t('Saving events is not switched on yet.')
      : error.message);
  }
}

// ---------------------------------------------------------------------------
//  Sharing
// ---------------------------------------------------------------------------
export function shareText(post) {
  const when = post.event_date ? formatEventWhen(post.event_date, post.start_time) : null;
  return [post.title, [when, post.location ?? post.city].filter(Boolean).join(' · '), t('On Tadbirly:')]
    .filter(Boolean).join('\n');
}

export const telegramShareUrl = (url, text) =>
  `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

// The phone's own share sheet; on a laptop browser without one, copies the link.
export async function shareEvent(post) {
  const url = eventUrl(post.id);
  const text = shareText(post);
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: post.title, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      notify(t('Link copied'), t('Paste it anywhere to share this event.'));
      return;
    }
    await Share.share({ message: `${text}\n${url}`, url, title: post.title });
  } catch { /* closed the share sheet */ }
}

export function shareToTelegram(post) {
  openUrl(telegramShareUrl(eventUrl(post.id), shareText(post)));
}

function openUrl(url) {
  if (Platform.OS === 'web') {
    try { window.open(url, '_blank', 'noopener'); return; } catch { /* fall through */ }
  }
  Linking.openURL(url).catch(() => {});
}

// ---------------------------------------------------------------------------
//  Calendar — Google Calendar link everywhere, plus an .ics file on the web
//  (Apple Calendar, Outlook).
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');

// Tashkent is UTC+5 all year: turn local wall-clock into UTC "YYYYMMDDTHHMMSSZ".
function utcStamp(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = String(time).slice(0, 5).split(':').map(Number);
  const ms = Date.UTC(y, m - 1, d, hh - 5, mm);
  const u = new Date(ms);
  return `${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}00Z`;
}

function calendarRange(post) {
  if (!post.event_date) return null;
  if (post.start_time) {
    const start = utcStamp(post.event_date, post.start_time);
    // No end time in Tadbirly: assume three hours.
    const [hh, mm] = String(post.start_time).slice(0, 5).split(':').map(Number);
    const endH = hh + 3;
    const end = utcStamp(post.event_date, `${pad(Math.min(endH, 23))}:${pad(endH > 23 ? 59 : mm)}`);
    return { start, end, allDay: false };
  }
  const d = post.event_date.replace(/-/g, '');
  const next = new Date(`${post.event_date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const e = `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
  return { start: d, end: e, allDay: true };
}

export function canAddToCalendar(post) {
  return !!post?.event_date;
}

export function googleCalendarUrl(post) {
  const r = calendarRange(post);
  if (!r) return null;
  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(post.title)}`,
    `dates=${r.start}/${r.end}`,
    `details=${encodeURIComponent(`${(post.description ?? '').slice(0, 800)}\n\n${eventUrl(post.id)}`)}`,
    `location=${encodeURIComponent(post.location ?? post.city ?? '')}`,
  ];
  return `https://calendar.google.com/calendar/render?${params.join('&')}`;
}

function icsText(post) {
  const r = calendarRange(post);
  const esc = (s) => String(s ?? '').replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const dt = r.allDay ? ';VALUE=DATE' : '';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tadbirly//EN', 'BEGIN:VEVENT',
    `UID:${post.id}@tadbirly`,
    `DTSTAMP:${utcStamp(new Date().toISOString().slice(0, 10), '05:00')}`,
    `DTSTART${dt}:${r.start}`, `DTEND${dt}:${r.end}`,
    `SUMMARY:${esc(post.title)}`,
    `LOCATION:${esc(post.location ?? post.city)}`,
    `DESCRIPTION:${esc(`${(post.description ?? '').slice(0, 800)}\n\n${eventUrl(post.id)}`)}`,
    `URL:${eventUrl(post.id)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

export function addToGoogleCalendar(post) {
  const url = googleCalendarUrl(post);
  if (url) openUrl(url);
}

// Web only: downloads tadbirly-event.ics for Apple Calendar / Outlook.
export function downloadIcs(post) {
  if (Platform.OS !== 'web' || !calendarRange(post)) return;
  const blob = new Blob([icsText(post)], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tadbirly-event.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
//  Maps — OpenStreetMap, no API key.
// ---------------------------------------------------------------------------
export const hasPlace = (post) => typeof post?.lat === 'number' && typeof post?.lng === 'number';

export function mapEmbedUrl(lat, lng) {
  const d = 0.006;
  const bbox = [lng - d, lat - d * 0.6, lng + d, lat + d * 0.6].join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

// Opens the place in Google Maps (works on every phone and laptop; on a
// phone with Yandex or Apple Maps the browser offers those too).
export function openInMaps(post) {
  if (hasPlace(post)) openUrl(`https://www.google.com/maps/search/?api=1&query=${post.lat},${post.lng}`);
  else if (post.location) openUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${post.location}, ${post.city ?? 'Uzbekistan'}`)}`);
}

// Address search for organizers (OpenStreetMap Nominatim, Uzbekistan only).
export async function searchPlaces(q) {
  const query = String(q ?? '').trim();
  if (query.length < 3) return [];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=uz&accept-language=en&q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return (rows ?? []).map((r) => ({
      label: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
//  "For you" — a simple, explainable score from the student's interests,
//  skills and city. No black box: interests matter most, then skills, then
//  being in your city, then how soon it is.
// ---------------------------------------------------------------------------
const words = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter((w) => w.length > 2);

export function scorePost(post, profile, savedIds) {
  let score = 0;
  const interests = (profile?.interests ?? []).map((x) => String(x).toLowerCase());
  if (interests.includes(String(post.category ?? '').toLowerCase())) score += 50;
  if (interests.includes('internship') && post.kind === 'internship') score += 30;

  const text = new Set(words(`${post.title} ${post.description ?? ''} ${post.looking_for ?? ''}`));
  const skills = (profile?.skills ?? []).flatMap((s) => words(s));
  const hits = skills.filter((s) => text.has(s)).length;
  score += Math.min(hits, 3) * 12;

  if (profile?.city && post.city && profile.city.toLowerCase() === String(post.city).toLowerCase()) score += 15;
  if (post.is_online) score += 8;
  if (post.boosted) score += 10;
  if (savedIds?.has(post.id)) score -= 5; // already on their radar

  if (post.event_date) {
    const days = (new Date(`${post.event_date}T00:00:00`) - Date.now()) / 86400000;
    if (days >= 0 && days <= 14) score += 14 - days;
  }
  return score;
}
