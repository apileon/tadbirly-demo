// Supabase Edge Function: telegram-webhook
//
// Telegram calls this for every message a student sends our bot (and when
// someone blocks it). All it does is pass the update to the database —
// public.telegram_handle_update() in supabase/24_telegram.sql does the rest:
// linking a chat to an account, /stop, replies.
//
// Deploy (either way), and keep "Verify JWT" OFF — Telegram doesn't send a
// Supabase token, so with it on every call is refused with 401:
//   Dashboard → Edge Functions → Deploy a new function → Via Editor,
//     name it  telegram-webhook , paste this file, Deploy; then in the
//     function's settings switch "Enforce JWT verification" off.
//   CLI:  supabase functions deploy telegram-webhook --no-verify-jwt
// Then register it with Telegram (setWebhook block at the bottom of
// 24_telegram.sql). Full walkthrough: README.md next to this file.
//
// This function holds no secrets. setWebhook gave Telegram a secret_token,
// which it sends back on every call (X-Telegram-Bot-Api-Secret-Token); we
// hand it to the database, which compares it with app_config. Without the
// exact secret the call changes nothing.
//
// Always answers 200 "ok" (except to non-POST requests, which aren't
// Telegram): Telegram keeps re-sending any update that gets another answer.

const RPC_TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 1_000_000; // real updates are a few KB

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  // Not from Telegram (or setWebhook was run without secret_token). The
  // database would refuse it anyway — this just saves the round trip.
  const secret = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!secret) return ok();

  let update: unknown = null;
  try {
    const text = await req.text();
    if (text.length <= MAX_BODY_CHARS) update = JSON.parse(text);
  } catch {
    // not JSON — ignore
  }
  if (!update || typeof update !== 'object' || Array.isArray(update)) return ok();

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    console.error('[telegram-webhook] SUPABASE_URL or SUPABASE_ANON_KEY is missing');
    return ok();
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/telegram_handle_update`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ u: update, secret }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 500);
      console.error('[telegram-webhook] telegram_handle_update failed', res.status, detail);
    }
  } catch (e) {
    console.error('[telegram-webhook] could not reach the database', String(e));
  }

  return ok();
});

function ok() {
  return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
