// Supabase Edge Function: permanently delete the signed-in user's account.
// Apple Guideline 5.1.1(v) and Google Play's account-deletion policy require
// in-app account deletion that removes the account AND its data.
//
// Deploy (Supabase CLI):
//   supabase functions deploy delete-account
// verify_jwt can stay ON (the default): the app calls this with the user's
// session token. The function ALSO checks the token itself below.
//
// Contract with the app (lib/moderation.js → deleteAccount):
//   supabase.functions.invoke('delete-account')   — POST, no body needed
//   200 { success: true, removedFiles: n }         — account is gone
//   401 { error }  bad/missing token   ·   500 { error }  could not delete
//
// What it does, in order:
//   1. identifies the caller from their JWT (never from the request body)
//   2. removes the photos they uploaded (avatars / covers / news buckets)
//   3. best-effort: removes their OneSignal push user (only if the OneSignal
//      keys are already stored in public.app_config — nothing is hardcoded)
//   4. deletes the auth user with the service-role client. That cascades to
//      the profile and everything that references it (posts, applications,
//      chats, messages, news, comments, likes, teams, reports, blocks,
//      notifications, Telegram link, ...) via ON DELETE CASCADE.
//
// Env (provided automatically by Supabase): SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. No other secrets are needed.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKETS = ['avatars', 'covers', 'news'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ error: 'Missing token' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json({ error: 'Server is not configured' }, 500);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Who is calling? getUser(jwt) validates the token with Supabase Auth,
    //    so an expired or forged token is rejected here.
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (userErr || !user) return json({ error: 'Invalid or expired session. Please log in again.' }, 401);
    const uid = user.id;

    // 2. Find their uploaded photos now, while their rows (with the image
    //    URLs) still exist. Best-effort: a storage hiccup must not keep
    //    someone from deleting their account.
    let files = new Map<string, Set<string>>();
    try {
      files = await findUserFiles(admin, uid);
    } catch (e) {
      console.error('[delete-account] listing files failed', uid, String(e));
    }

    // 3. OneSignal push user (best-effort, skipped when keys aren't set).
    try {
      await removeOneSignalUser(admin, uid);
    } catch (e) {
      console.error('[delete-account] OneSignal cleanup failed', uid, String(e));
    }

    // 4. The account itself (cascades to all their rows). Files are removed
    //    after it, so a failed deletion never leaves an account without its
    //    photos. Older Storage versions refused to delete a user who still
    //    owned files — then remove the files first and try once more.
    let removedFiles = 0;
    let { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) {
      console.warn('[delete-account] deleteUser failed, retrying after file cleanup', uid, delErr.message);
      removedFiles = await removeFiles(admin, files);
      files = new Map();
      ({ error: delErr } = await admin.auth.admin.deleteUser(uid));
    }
    if (delErr) {
      console.error('[delete-account] deleteUser failed', uid, delErr.message);
      return json({ error: 'Could not delete the account: ' + delErr.message }, 500);
    }

    // 5. Their photos.
    removedFiles += await removeFiles(admin, files);

    return json({ success: true, removedFiles });
  } catch (e) {
    console.error('[delete-account] unexpected', String(e));
    return json({ error: String(e) }, 500);
  }
});

// Files are uploaded with random names (lib/news.js), so they're found by
// their Storage owner via public.storage_objects_owned_by (supabase/27,
// service role only). Without 27 the account is still deleted; only the
// photo cleanup is skipped (and logged).
async function findUserFiles(admin: SupabaseClient, uid: string): Promise<Map<string, Set<string>>> {
  const byBucket = new Map<string, Set<string>>();
  const add = (bucket: string, name: string) => {
    if (!BUCKETS.includes(bucket) || !name) return;
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
    byBucket.get(bucket)!.add(name);
  };

  // Only files whose Storage owner is this user. (Deliberately NOT the image
  // URLs saved on their rows: anyone can save any URL there, and the
  // service role would happily delete another person's photo.)
  const { data: owned, error: ownedErr } = await admin.rpc('storage_objects_owned_by', { uid });
  if (ownedErr) {
    console.warn('[delete-account] storage_objects_owned_by unavailable (run supabase/27):', ownedErr.message);
    return byBucket;
  }
  for (const o of (owned ?? []) as { bucket_id: string; name: string }[]) add(o.bucket_id, o.name);
  return byBucket;
}

// Never throws: returns how many files were removed.
async function removeFiles(admin: SupabaseClient, byBucket: Map<string, Set<string>>): Promise<number> {
  let removed = 0;
  for (const [bucket, names] of byBucket) {
    const list = [...names];
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      try {
        const { data, error } = await admin.storage.from(bucket).remove(chunk);
        if (error) console.warn('[delete-account] remove failed', bucket, error.message);
        else removed += data?.length ?? 0;
      } catch (e) {
        console.warn('[delete-account] remove threw', bucket, String(e));
      }
    }
  }
  return removed;
}

// Uses the same OneSignal keys the database push trigger already uses
// (public.app_config, readable only with the service role).
async function removeOneSignalUser(admin: SupabaseClient, uid: string): Promise<void> {
  const { data, error } = await admin
    .from('app_config')
    .select('key, value')
    .in('key', ['onesignal_app_id', 'onesignal_api_key']);
  if (error || !data) return;
  const cfg = Object.fromEntries(data.map((r: { key: string; value: string }) => [r.key, r.value]));
  const appId = cfg.onesignal_app_id;
  const apiKey = cfg.onesignal_api_key;
  if (!appId || !apiKey || appId.startsWith('PASTE_') || apiKey.startsWith('PASTE_')) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(
      `https://api.onesignal.com/apps/${encodeURIComponent(appId)}/users/by/external_id/${encodeURIComponent(uid)}`,
      { method: 'DELETE', headers: { Authorization: `Key ${apiKey}` }, signal: ctrl.signal },
    );
    // 404 = they never enabled push; nothing to remove.
    if (!res.ok && res.status !== 404) {
      console.warn('[delete-account] OneSignal answered', res.status, await res.text());
    }
  } finally {
    clearTimeout(timer);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
