# Tadbirly — MVP (React Native + Expo + Supabase)

Every opportunity in Uzbekistan — one tap away. This is the real, runnable MVP: one
codebase that builds to **iOS and Android**, backed by a live database with accounts,
posts, applications, realtime chat, venues, a Pro plan and an AI coach.

---

## What works today

| Feature | Status |
|---|---|
| Email/password accounts (auto-created profile) | ✅ real |
| Feed with category tabs (Events / Requests / Internships / MUN) + search | ✅ real, from DB |
| Create post (event or request) with free-plan cap of 3 events/month | ✅ real |
| Post detail + Apply (opens a chat with the organizer) | ✅ real |
| Realtime 1:1 chat | ✅ real (Supabase Realtime) |
| Profile with reliability score + live application/post counts | ✅ real |
| Venues list + booking request | ✅ real (map view is a placeholder) |
| Pro paywall (flips `is_pro`) | ⚠️ payment stubbed — see below |
| AI Career Coach | ⚠️ rule-based heuristic — swap for an LLM call |

---

## 1. Run it locally (5 minutes)

```bash
cd "tadbirly-app"
npm install            # or: npx expo install  (recommended — pins RN-compatible versions)
npx expo start
```

Scan the QR code with the **Expo Go** app (App Store / Play Store) on your phone. The app
loads instantly — no build needed while developing.

## 2. Connect the backend (Supabase — free)

1. Create a project at https://supabase.com.
2. Open **SQL Editor** → paste `supabase/schema.sql` → **Run**. (Creates tables + security.)
   Then paste `supabase/02_moderation.sql` → **Run** (reports, blocks, account deletion support).
3. (Optional) After you sign up your first user, run `supabase/seed.sql` for demo posts.
   For in-app account deletion, deploy the edge function:
   `supabase functions deploy delete-account --no-verify-jwt`
4. In **Project Settings → API**, copy the **Project URL** and **anon public key**.
5. Paste them into `app.json` → `expo.extra.supabaseUrl` and `expo.extra.supabaseAnonKey`.
6. In **Database → Replication**, make sure Realtime is on for the `messages` table.
7. Restart `npx expo start`.

That's it — sign up, post, apply, chat.

## 3. Ship to the App Store & Google Play

You need your own developer accounts: **Apple Developer** ($99/yr) and **Google Play**
($25 one-time). Then:

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android      # produces an .aab / .apk
eas build --platform ios          # requires the Apple account
eas submit --platform android     # uploads to Play Console
eas submit --platform ios         # uploads to App Store Connect
```

Both stores then run their review (a few hours to a few days). Full guide:
https://docs.expo.dev/submit/introduction/

---

## Before you launch — the two stubs to finish

- **Payments (Pro).** `app/pro.js` currently flips `is_pro` directly. Replace with a real
  provider — **RevenueCat** is easiest for app-store in-app purchases; local card rails
  **Payme / Click** work for web/off-store. Set `is_pro` from a **server-side webhook**,
  never from the client.
- **AI coach.** `app/coach.js` uses a simple rule. Point it at an LLM endpoint (e.g. an
  Anthropic/OpenAI call behind a Supabase Edge Function so your key stays server-side).

## Project structure

```
app/
  _layout.js          root nav + auth redirect
  (auth)/             login, signup
  (tabs)/             feed, venues, create, chats, profile
  post/[id].js        post detail + apply
  chat/[id].js        realtime conversation
  pro.js  coach.js    paywall, AI coach
lib/       supabase client, auth context, theme
components/ shared UI (Button, Card, Tag)
supabase/  schema.sql, seed.sql
```

## Roadmap ideas (see the chat message that shipped this)

Post moderation queue · QR e-ticket + check-in scanner (reliability score driver) ·
push notifications · organizer analytics · venue map with `react-native-maps` ·
university email verification for the "verified student" badge.
