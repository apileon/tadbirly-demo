// Filling the feed without much effort:
//  - organizers paste a Telegram post / link and the `extract-opportunity`
//    edge function pre-fills the event form (they still review and publish);
//  - students suggest opportunities (opportunity_submissions, 30_opportunities.sql)
//    and admins turn them into events from /admin/review.
import { supabase } from './supabase';
import { EVENT_TYPE_KEYS, CITIES, EVENT_LANGUAGES } from './theme';
import { parseEventDate, parseStartTime, TITLE_MAX, DESCRIPTION_MAX } from './events';

export const PASTE_MAX = 6000;          // keep in sync with the edge function
export const SUGGEST_TITLE_MAX = 120;
export const SUGGEST_DETAILS_MAX = 5000;
const LANG_KEYS = EVENT_LANGUAGES.map((l) => l.key);

// ---------- paste to fill ----------

// { ok: true, data } | { ok: false, code }  (code: not_configured | forbidden | network | ai_error | …)
export async function extractOpportunity(text) {
  const body = { text: String(text ?? '').trim().slice(0, PASTE_MAX) };
  try {
    const { data, error } = await supabase.functions.invoke('extract-opportunity', { body });
    if (!error) return data && typeof data === 'object' && !data.error ? { ok: true, data } : { ok: false, code: data?.error ?? 'server_error' };
    const ctx = error.context;
    let payload = null;
    let status = null;
    if (ctx && typeof ctx.json === 'function') {
      status = ctx.status ?? null;
      try { payload = await ctx.json(); } catch { payload = null; }
    }
    if (status === 404) return { ok: false, code: 'not_configured' }; // not deployed yet
    return { ok: false, code: payload?.error ?? (status ? 'server_error' : 'network') };
  } catch {
    return { ok: false, code: 'network' };
  }
}

const addLink = (text, url) => {
  const s = String(text ?? '').trim();
  if (!url || s.includes(url)) return s;
  return s ? `${s}\n\n🔗 ${url}` : `🔗 ${url}`;
};

// Pasted text kept in Details when auto-fill can't help (nothing is lost).
export function keepPasted(form, pasted) {
  const p = String(pasted ?? '').trim();
  if (!p || String(form.description ?? '').includes(p)) return form;
  const desc = String(form.description ?? '').trim();
  return { ...form, description: (desc ? `${desc}\n\n${p}` : p).slice(0, DESCRIPTION_MAX) };
}

// The edge function's answer → the event form. Only fields it found are
// changed; everything stays editable before publishing.
export function applyExtracted(form, x, pasted) {
  const next = { ...form };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  if (str(x.title)) next.title = str(x.title).slice(0, TITLE_MAX);
  if (EVENT_TYPE_KEYS.includes(x.category)) { next.type = x.category; next.custom = ''; }
  if (parseEventDate(x.event_date)) next.date = x.event_date;
  if (parseEventDate(x.deadline)) next.deadline = x.deadline;
  if (parseStartTime(x.start_time)) next.time = parseStartTime(x.start_time);
  if (typeof x.is_online === 'boolean') next.is_online = x.is_online;
  if (!next.is_online) {
    if (str(x.location)) { next.location = str(x.location).slice(0, 200); next.lat = null; next.lng = null; }
    if (CITIES.includes(x.city)) next.city = x.city;
  }
  if (typeof x.is_free === 'boolean') {
    next.is_free = x.is_free;
    next.fee = x.is_free ? '' : str(x.fee).slice(0, 60);
  }
  if (LANG_KEYS.includes(x.language)) next.language = x.language;
  const desc = str(x.description) || String(pasted ?? '').trim();
  next.description = addLink(desc, typeof x.external_url === 'string' ? x.external_url : null).slice(0, DESCRIPTION_MAX);
  return next;
}

// ---------- student suggestions ----------

// { error } like supabase; error.code 'daily_limit' when over 5 a day.
export async function submitSuggestion({ userId, title, link, date }) {
  const raw = String(link ?? '').trim();
  const isUrl = /^https?:\/\/\S+$/i.test(raw);
  const row = {
    submitted_by: userId,
    title: String(title ?? '').trim().slice(0, SUGGEST_TITLE_MAX),
    url: isUrl ? raw.slice(0, 500) : null,
    details: isUrl ? null : raw.slice(0, SUGGEST_DETAILS_MAX),
    event_date: String(date ?? '').trim() || null,
  };
  const { error } = await supabase.from('opportunity_submissions').insert(row);
  if (error && /daily_limit/.test(error.message ?? '')) return { error: { ...error, code: 'daily_limit' } };
  return { error };
}

export async function pendingSubmissions() {
  const { data, error } = await supabase
    .from('opportunity_submissions')
    .select('id, title, url, details, event_date, created_at, submitter:profiles!opportunity_submissions_submitted_by_fkey(full_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100);
  return { data: data ?? [], error };
}

// status 'approved' (with the new post's id) | 'rejected'.
export function markReviewed(id, status, postId = null) {
  return supabase.rpc('mark_submission_reviewed', { p_id: id, p_status: status, p_post_id: postId });
}

// Route params for "Create event" in /admin/review → /create.
export function submissionParams(s) {
  return {
    submission: s.id,
    title: s.title ?? '',
    description: s.details ?? '',
    url: s.url ?? '',
    date: s.event_date ?? '',
  };
}

// /create's route params → form patch (empty when it wasn't opened from a suggestion).
export function formFromParams(form, p) {
  const one = (v) => (Array.isArray(v) ? v[0] : v) ?? '';
  const next = { ...form, title: String(one(p.title)).slice(0, TITLE_MAX) };
  next.description = addLink(String(one(p.description)), one(p.url) || null).slice(0, DESCRIPTION_MAX);
  if (parseEventDate(one(p.date))) next.date = one(p.date);
  return next;
}
