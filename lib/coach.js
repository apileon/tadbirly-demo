// AI Career Coach client. Talks to the `career-coach` edge function
// (supabase/functions/career-coach), which does auth, the daily cap and the
// Claude call server-side. Nothing here holds an API key.
import { supabase } from './supabase';
import { t } from './i18n';

export const COACH_MAX_QUESTION = 1000; // keep in sync with the edge function
const HISTORY_TURNS = 6;

// Normalised result:
//   { ok: true, reply, events: [{id,title,category,date}], used, cap }
//   { ok: false, code, message, used?, cap? }
// code: 'not_configured' | 'daily_limit' | 'global_limit' | 'unauthorized'
//       | 'bad_request' | 'network' | 'ai_error' | 'server_error'
async function invoke(body) {
  try {
    const { data, error } = await supabase.functions.invoke('career-coach', { body });
    if (!error) return data && typeof data === 'object' ? { ok: true, data } : fail('server_error');

    // FunctionsHttpError keeps the Response in error.context.
    let payload = null;
    let status = null;
    const ctx = error.context;
    if (ctx && typeof ctx.json === 'function') {
      status = ctx.status ?? null;
      try { payload = await ctx.json(); } catch { payload = null; }
    }
    if (error.name === 'FunctionsFetchError' || (!payload && !status)) return fail('network');
    if (status === 404) return fail('not_configured'); // function not deployed yet
    const code = payload?.error
      ?? (status === 401 ? 'unauthorized' : status === 429 ? 'daily_limit' : status === 503 ? 'not_configured' : 'server_error');
    return fail(code, payload?.message, payload);
  } catch {
    return fail('network');
  }
}

async function call(body) {
  const res = await invoke(body);
  if (!res.ok) return res;
  const data = res.data;
  if (typeof data.reply !== 'string') return fail('server_error');
  return {
    ok: true,
    reply: data.reply,
    events: Array.isArray(data.events) ? data.events : [],
    used: data.used ?? null,
    cap: data.cap ?? null,
  };
}

function fail(code, message, extra) {
  return { ok: false, code, message: message ?? null, used: extra?.used ?? null, cap: extra?.cap ?? null };
}

// History: the last few turns of the on-screen conversation.
function trimHistory(messages) {
  return (messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
}

// Cheap availability check: { ok:true } when configured, else { ok:false, code }.
export async function getCoachStatus() {
  const res = await invoke({ mode: 'status' });
  return res.ok ? { ok: true } : res;
}

// The same, asked at most once per session (the Profile menu shows a "Soon"
// tag from it). Network failures aren't remembered, so a later ask can retry.
let statusCache = null;
let statusAsk = null;
export function peekCoachStatus() {
  return statusCache;
}
export function getCoachStatusCached() {
  if (statusCache) return Promise.resolve(statusCache);
  if (!statusAsk) {
    statusAsk = getCoachStatus().then((res) => {
      if (res.ok || res.code !== 'network') statusCache = res;
      statusAsk = null;
      return res;
    });
  }
  return statusAsk;
}

export function askCoach(question, history) {
  return call({ mode: 'chat', question: String(question ?? '').trim().slice(0, COACH_MAX_QUESTION), history: trimHistory(history) });
}

export function getCoachPlan(history) {
  return call({ mode: 'plan', history: trimHistory(history) });
}

// Short, friendly text for each failure code.
export function coachErrorText(res) {
  switch (res?.code) {
    case 'not_configured':
      return t('Coach is coming soon. We are finishing the setup — check back shortly.');
    case 'daily_limit':
      return `You've used all ${res.cap ?? 10} coach answers for today. Come back tomorrow!`;
    case 'global_limit':
      return t('The coach is very busy today. Please try again tomorrow.');
    case 'unauthorized':
      return t('Please sign in again to use the coach.');
    case 'bad_request':
      return res.message ? `Couldn't send that: ${res.message}.` : "Couldn't send that question.";
    case 'network':
      return t('No connection. Check your internet and try again.');
    default:
      return t('The coach could not answer right now. Please try again in a minute.');
  }
}
