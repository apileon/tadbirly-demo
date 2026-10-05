# Telegram notifications — setup

Students connect their Telegram once (**Profile → Connect Telegram**). From then on
every Tadbirly notification — friend requests, messages, acceptances — also arrives
as a message from the Tadbirly bot. It works on every phone, including iPhones where
web push needs Tadbirly on the Home Screen.

Pieces: `supabase/24_telegram.sql` (tables, functions, the new `send_push`),
this edge function (Telegram → database), and the Profile card / feed strip in the app.

Takes about 15 minutes. Do the steps in order.

---

## 1. Create the bot (Telegram, @BotFather)

1. In Telegram, open **@BotFather** (blue tick) and send `/newbot`.
2. Name: `Tadbirly`
3. Username: `tadbirly_bot` — it must end in `bot`. If it's taken, try
   `tadbirly_uz_bot`, `tadbirlyapp_bot`, …
4. BotFather replies with a **token** like `123456789:AAH…`.
   Treat it like a password: anyone who has it can message every connected student
   as Tadbirly. Don't paste it into a chat, a screenshot, or any file you commit.
   If it ever leaks: BotFather → `/revoke`, then redo step 3 and step 5 with the new one.

Optional polish (all in BotFather):

- `/setuserpic` → pick the bot → send `assets/tadbirly-icon-1024.png` **as a photo**.
- `/setdescription` (shown before a student presses Start):
  `Your Tadbirly notifications — friend requests, messages, event acceptances — right here in Telegram. Connect from Tadbirly → Profile → Connect Telegram.`
- `/setabouttext`: `Tadbirly notifications in Telegram.`
- `/setcommands`, then send:
  ```
  start - Connect Tadbirly or check the connection
  stop - Stop Tadbirly notifications here
  ```
- `/setjoingroups` → **Disable** (the bot only works in private chats anyway).

## 2. Run the SQL

Supabase Dashboard → **SQL Editor** → New query → paste all of
`supabase/24_telegram.sql` → **Run**.
You should see *Success. No rows returned*. (Needs 19–23 to have been run, which
they have.) Nothing changes for students yet.

## 3. Put in the token and the username

Still in the SQL Editor — this is the only place the token goes:

```sql
update public.app_config set value = 'PASTE-THE-TOKEN-FROM-BOTFATHER'
 where key = 'telegram_bot_token';
update public.app_config set value = 'tadbirly_bot'        -- your bot's username, no @
 where key = 'telegram_bot_username';
```

Check it took — all three rows should say `true`:

```sql
select key, public.telegram_config(key) is not null as ok
  from public.app_config where key like 'telegram%';
```

`false` for the token means it wasn't copied whole (it looks like `digits:letters`);
`false` for the username means it has characters a username can't have.

## 4. Deploy the edge function (Verify JWT **off**)

Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**:

1. Name it exactly **`telegram-webhook`**.
2. Replace the sample code with everything in `supabase/functions/telegram-webhook/index.ts`.
3. **Deploy**.
4. Open the function → its settings/details → switch **Enforce JWT verification**
   (a.k.a. "Verify JWT") **OFF** → Save.

Why off: Telegram doesn't send a Supabase login token, so with it on every message
from Telegram is refused (401) and nobody can connect. It's safe: the function has no
secrets, and the database ignores any call that doesn't carry the webhook secret.

With the CLI instead: `supabase functions deploy telegram-webhook --no-verify-jwt`

No secrets or environment variables to add — it uses the built-in
`SUPABASE_URL` / `SUPABASE_ANON_KEY`.

## 5. Tell Telegram where to send messages (setWebhook)

In the SQL Editor run this (it's also, commented out, at the bottom of
`24_telegram.sql`). It reads the token and the secret from `app_config`, so you
never type them:

```sql
select net.http_post(
  url     := 'https://api.telegram.org/bot'
             || coalesce(public.telegram_config('telegram_bot_token'), 'TOKEN-NOT-SET')
             || '/setWebhook',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body    := jsonb_build_object(
    'url',             'https://mezvvxosdcddninqgvjz.supabase.co/functions/v1/telegram-webhook',
    'secret_token',    public.telegram_config('telegram_webhook_secret'),
    'allowed_updates', jsonb_build_array('message', 'my_chat_member')
  )
) as request_id;
```

(`message` brings /start and /stop; `my_chat_member` tells us when a student blocks
the bot, so they're unlinked and get web push again.)

It returns a number (`request_id`). Wait ~5 seconds, then read Telegram's answer —
put that number in place of `12345`:

```sql
select status_code, content from net._http_response where id = 12345;
```

You want `200` and `{"ok":true,"result":true,"description":"Webhook was set"}`
(or `"Webhook is already set"`).

- No row yet → wait a few seconds and run it again.
- `401 Unauthorized` or `404 Not Found` → the token in step 3 is wrong.

Optional deeper check — Telegram's view of the webhook:

```sql
select net.http_get('https://api.telegram.org/bot'
  || coalesce(public.telegram_config('telegram_bot_token'), 'TOKEN-NOT-SET')
  || '/getWebhookInfo');
-- a few seconds later, with the number it returned:
select content from net._http_response where id = 12345;
```

Look for the right `"url"`, and no `"last_error_message"`. If it says
`Wrong response from the webhook: 401 Unauthorized`, Verify JWT is still on (step 4).

## 6. Redeploy the web app

The Profile card and the feed strip ship with the app, so publish a new web build the
usual way (for EAS Hosting: `npx expo export --platform web`, then `eas deploy --prod`).

## 7. Test it

1. Open Tadbirly → **Profile**. A **Telegram notifications** card appears under the
   notification button.
2. Tap **Connect Telegram** → Telegram opens the bot → press **Start**.
3. The bot replies *"✅ Connected, <your name>! …"*. Back in Tadbirly the card shows
   **Connected ✓**, then *Connected as @yourname*.
4. Ask a friend to send you a friend request → a Telegram message arrives with an
   **Open in Tadbirly** button.
5. Try `/stop` in the bot, or **Disconnect** in the app — both unlink.

---

## How it behaves

- **Connected students** get notifications in Telegram only; web push for them is
  skipped unless they switch on **Also send browser notifications** on the card.
- **Everyone else** gets web push exactly as before (the OneSignal part of `send_push`
  is unchanged).
- Chat notifications keep the 15-second throttle: a burst of messages is one
  Telegram message ("4 new messages"), not one per message.
- **Blocking the bot** in Telegram unlinks automatically, so that student falls back
  to web push instead of silently getting nothing.
- **Link codes** are single-use, expire after an hour, and linking spends all of a
  student's open codes at once. Connecting the same Telegram to a second account
  moves it (a shared phone); connecting an account to a new Telegram tells the old
  chat.
- **Switch Telegram off** at any time: set `telegram_bot_token` back to
  `PASTE_BOT_TOKEN_HERE`. The card disappears and everybody gets web push again.

## If something's off

| Symptom | Check |
|---|---|
| No Telegram card in Profile | Step 3 check query; step 6 (new web build); hard-refresh the app. |
| Pressing Start does nothing | Step 5 answer and `getWebhookInfo`; Dashboard → Edge Functions → telegram-webhook → **Logs**. |
| Bot says the link expired | The link is valid for an hour and works once — tap **Connect Telegram** again. |
| Connected, but no messages arrive | Run the query below and read Telegram's answer. |

Telegram's answer for recent notifications:

```sql
select n.created_at, n.type, r.status_code, r.content
  from public.notifications n
  join net._http_response r on r.id = n.telegram_request_id
 order by n.created_at desc
 limit 10;
```

`403 … bot was blocked by the user` means that student blocked the bot (they get
unlinked automatically). `pg_net` keeps these answers for a few hours only.
