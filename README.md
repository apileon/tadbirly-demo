# Tadbirly (React Native + Expo + Supabase)

Every opportunity in Uzbekistan, one tap away. One codebase that runs on the **web**
(tadbirly.expo.app), **Android** and **iOS**, backed by Supabase: accounts, events,
applications, realtime chat, teams, rankings and an AI career coach.

---

## Features

**Students**
- Feed with **For you** (ranked by interests, skills and city) and **Upcoming** views,
  search, and filters for category, city, language, free, online and closing soon.
- **Saved events** with reminders the day before an application deadline or event.
- **Add to calendar** (Google Calendar; .ics for Apple/Outlook on the web), **share** via
  the phone's share sheet or straight to **Telegram**.
- Apply, including the organizer's **custom questions**; teams apply together.
- **QR ticket** once accepted; **rate and review** events afterwards.
- Student Passport, medals, points ranking, friends, 1:1 and event chats, news.
- **Team Builder** with skills each team needs, matched against your Passport skills.
- **AI Career Coach** (Claude, via the `career-coach` edge function).
- Onboarding (language, interests, city), **English / O'zbekcha / Русский**, **dark mode**.

**Organizers**
- Post and edit events: cover, category, solo/team, city or online, **map pin**
  (address search, OpenStreetMap), date, time, **application deadline**, language,
  free or paid, application questions.
- Review applicants (with their answers), accept, chat, award medals, end events.
- **Scan QR tickets** at the door (or tick people off a list).
- **Event stats**: views, applications, accepted, checked in, saves, ratings.
- Public organizer page with rating, totals and open events.

**Safety**: report / block on events, teams, profiles, posts, comments and messages;
account deletion; reports push an alert to admins (`profiles.is_admin`).

---

## 1. Run it locally

```bash
npm install
npx expo start
```

Press `w` for the web version, or scan the QR code with a development build.

## 2. Database (Supabase)

Run the SQL files in `supabase/` **in number order** in the SQL Editor (each is safe to
re-run): `schema.sql`, then `02_…` through `29_growth.sql`. `29_growth.sql` adds saved
events, deadline reminders, interests/onboarding, event language/price/online/map/questions,
views and organizer stats, reviews, QR check-in codes and team skills. The app keeps
working without it; those features simply stay hidden until it's installed.

Reminders run on **pg_cron** (25 and 29 schedule themselves; enable the Cron integration
if the result row says "NOT scheduled").

Edge functions (Dashboard → Edge Functions, or `supabase functions deploy <name>`):
- `career-coach`: needs `28_coach.sql` and the secret `ANTHROPIC_API_KEY`
  (optional: `COACH_MODEL`, `COACH_DAILY_CAP`, `COACH_GLOBAL_CAP`). Without the key the
  coach screen says "coming soon".
- `delete-account`: deploy with `--no-verify-jwt`.
- `telegram-webhook`: Telegram notifications (see `24_telegram.sql`).

`app.json` → `expo.extra` holds the Supabase URL and anon key.

## 3. Ship

**Web:** `npm run deploy` (exports and deploys to EAS Hosting).

**Phone apps:** QR scanning, QR tickets and the map use native modules
(`expo-camera`, `react-native-svg`, `react-native-webview`), so they need a new build:

```bash
npx eas-cli build --platform android
npx eas-cli build --platform ios
npx eas-cli submit --platform android
npx eas-cli submit --platform ios
```

Older installed builds keep working; they skip the map and show "Update Tadbirly to see
your QR ticket" until updated.

---

## Project structure

```
app/
  _layout.js            root stack, auth + onboarding redirects, language provider
  (auth)/               login, signup, reset
  (tabs)/               feed, create, team-builder, my-events, portal, chats, profile
  post/[id].js          event page: apply, save, share, calendar, map, ticket, reviews
  onboarding.js         language, interests, city
  saved.js  settings.js dashboard.js  scan/[postId].js  review/[postId].js
components/
  ui.js                 Button, TextField, Chip, IconButton, EmptyState, Avatar, …
  EventCard.js EventForm.js MapPreview.js Ticket.js Stars.js
lib/
  theme.js              colours (light/dark), type scale, shadows, categories, cities
  i18n.js + locales/    t('English text') → uz / ru dictionaries
  discover.js           saved events, sharing, calendar, maps, "For you" ranking
supabase/               numbered SQL migrations + edge functions
```

### Translating
Text is written in English inside `t('…')`; `lib/locales/uz.js` and `ru.js` map each
English sentence to its translation (missing ones fall back to English). Placeholders
look like `{n}` / `{name}`. Have a native speaker review both files before a big launch.
