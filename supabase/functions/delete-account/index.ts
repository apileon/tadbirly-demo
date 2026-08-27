// Supabase Edge Function: delete the signed-in user's account.
// Apple Guideline 5.1.1(v) requires in-app account deletion.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy delete-account --no-verify-jwt
// (It verifies the JWT itself below, so --no-verify-jwt is fine.)
//
// It uses the SERVICE ROLE key (available to edge functions as an env var)
// to remove the auth user. Deleting the auth user cascades to the profile
// and all their posts/applications/chats via the ON DELETE CASCADE rules.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing token' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey);

    // Identify the caller from their JWT.
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Invalid token' }, 401);

    // Delete the user (cascades to their data).
    const { error: delErr } = await admin.auth.admin.deleteUser(userData.user.id);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ success: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
