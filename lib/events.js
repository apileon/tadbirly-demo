import { supabase } from './supabase';

export const noPermission = () => ({ message: "You don't have permission to do that." });

// Row-level security doesn't raise an error when it blocks an UPDATE or
// DELETE: Postgres just matches no rows and supabase-js reports success, so
// the UI would happily say "done". Asking for the ids back tells the two
// apart. Pass the query *before* awaiting it; returns the usual { data, error }.
export async function requireRows(query) {
  const { data, error } = await query.select('id');
  if (error) return { data: null, error };
  if (!data || data.length === 0) return { data: null, error: noPermission() };
  return { data, error: null };
}

// End an event: mark it completed and post the organizer's closing
// feedback into the event's group chat (seen by every accepted participant).
export async function endEvent(postId, feedback) {
  const { data: auth } = await supabase.auth.getUser();
  // getUser() is a network call: on a blip it resolves with user: null
  // instead of throwing, so check before touching the id.
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not signed in');

  const { error } = await requireRows(
    supabase.from('posts').update({ status: 'completed' }).eq('id', postId),
  );
  if (error) throw error;

  const { count } = await supabase
    .from('applications')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId)
    .eq('status', 'accepted');

  const msg = feedback?.trim();
  if (msg) {
    const { error: msgErr } = await supabase.from('event_messages').insert({
      post_id: postId,
      sender_id: uid,
      body: `🏁 Event finished — feedback from the organizer:\n${msg}`,
    });
    if (msgErr) throw msgErr;
  }
  return { count: count ?? 0 };
}

// ---- Event form checks, shared by "Post an event" and "Edit event" ----

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 5000;
export const SPOTS_MAX = 100000; // keeps us far below Postgres' integer limit

// "YYYY-MM-DD" -> local-midnight Date, or null if it isn't a real day.
// new Date(2026, 1, 31) silently rolls over to 3 March, so the parts are
// read back and must match what was typed.
export function parseEventDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

// Optional start time, 24-hour: "9:30" / "09:30" / "21:05" -> "09:30" / "21:05";
// null when empty or not a real time ("25:00", "9:75"). "9.30" and "9,30"
// count too: the box opens a number pad, and on Uzbek/Russian phones that
// has "," or "." but no ":".
export function parseStartTime(text) {
  const m = /^(\d{1,2})[:.,](\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// The value to store in posts.start_time (a Postgres time), or null.
export const startTimeValue = (text) => {
  const t = parseStartTime(text);
  return t ? `${t}:00` : null;
};

// "15:00:00", as the database returns it -> "15:00"; '' when there's none.
export function formatStartTime(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

// Returns [title, message] ready for notify(), or null when the form is fine.
// `originalDate`: when editing, an event that already happened keeps its
// (past) date — only *changing* the date to a past day is refused, otherwise
// organizers couldn't fix a typo in an old event without faking its date.
export function eventFormProblem({ title, date, time, spots, description }, { originalDate } = {}) {
  const t = String(title ?? '').trim();
  if (!t) return ['Add a title'];
  if (t.length > TITLE_MAX) {
    return ['Title is too long', `Keep it under ${TITLE_MAX} characters — it's ${t.length} now.`];
  }
  const desc = String(description ?? '');
  if (desc.length > DESCRIPTION_MAX) {
    return ['Details are too long', `Keep them under ${DESCRIPTION_MAX} characters — they're ${desc.length} now.`];
  }

  const d = String(date ?? '').trim();
  if (d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return ['Check the date', 'Use the format YYYY-MM-DD, e.g. 2026-10-05.'];
    }
    const picked = parseEventDate(d);
    if (!picked) return ['Check the date', `${d} isn't a real date.`];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (picked < today && d !== originalDate) {
      return ['Date is in the past', 'Events can only be set for today or a future date.'];
    }
  }

  const tm = String(time ?? '').trim();
  if (tm) {
    if (!parseStartTime(tm)) {
      return ['Check the start time', 'Use 24-hour time, like 09:30 or 18:00 — or leave it empty.'];
    }
    // A time on its own means nothing: the reminders and the event page both
    // hang it on the date.
    if (!d) return ['Add the date', 'A start time needs a date to go with it.'];
  }

  const s = String(spots ?? '').trim();
  if (s && (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > SPOTS_MAX)) {
    return ['Check the spots', `Leave it empty, or enter a whole number from 1 to ${SPOTS_MAX}.`];
  }
  return null;
}

// The value to store for the spots field (already checked by eventFormProblem).
export const spotsValue = (spots) => {
  const s = String(spots ?? '').trim();
  return s ? parseInt(s, 10) : null;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ("2026-10-12", "15:00:00") -> "Mon 12 Oct · 15:00"; the year only when it
// isn't this one. English names on purpose: the screen around it is English
// whatever language the phone itself is set to.
export function formatEventWhen(date, time) {
  const d = parseEventDate(date);
  if (!d) return String(date ?? '');
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  const day = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
  const t = formatStartTime(time);
  return t ? `${day} · ${t}` : day;
}
