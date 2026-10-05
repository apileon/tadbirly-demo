// ---------------------------------------------------------------------------
//  Opening an in-app link (from a notification, a toast, …) the right way.
//
//  All the tab screens live inside ONE (tabs) navigator at the bottom of the
//  root stack. router.push('/(tabs)/portal') from a stacked screen
//  (Notifications, a chat) pushed a SECOND (tabs) navigator on top — a
//  duplicate tab bar, with Back walking through both. In expo-router 6 the
//  call that switches tab depends on where you are (checked in
//  build/global-state/routing.js, layouts/StackClient.js and
//  @react-navigation/routers StackRouter / TabRouter):
//
//   - inside the tabs     router.navigate(href) targets the tab navigator and
//                         switches tab, passing the params along.
//                         (router.dismissTo would target the tab navigator
//                         too, which has no POP_TO — it does nothing.)
//   - on a stacked screen router.dismissTo(href) pops back to the (tabs) route
//                         already in the stack and switches its tab; if there
//                         isn't one (the app was opened straight onto a chat
//                         from a push), it replaces the current screen.
//                         (router.navigate here pushes a new (tabs) — the bug.)
// ---------------------------------------------------------------------------

// Every path that is a tab rather than a screen of its own.
const TAB_PATHS = new Set(['/', '/portal', '/chats', '/profile', '/team-builder', '/my-events', '/create']);

// Notifications saved before links pointed at a Portal segment all say
// '/(tabs)/portal'. Their type still tells us which segment was meant.
const LEGACY_PORTAL_SEGMENT = {
  friend_request: 'networking',
  team_invite: 'teams',
  team_request: 'teams',
};

// The link to open for a notification row.
export function notificationLink(n) {
  const segment = LEGACY_PORTAL_SEGMENT[n?.type];
  if (segment && n.link === '/(tabs)/portal') return `/portal?tab=${segment}`;
  return n?.link ?? null;
}

// '/(tabs)/portal' → '/portal'. The group is a folder, not part of the URL.
export function normalizeLink(link) {
  const href = String(link).trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return href; // a full URL: leave it to the router
  const path = href.replace(/^\/?\(tabs\)(?=[/?#]|$)/, '');
  return path.startsWith('/') ? path : `/${path}`;
}

export function isTabLink(href) {
  const path = href.split(/[?#]/)[0].replace(/(.)\/+$/, '$1');
  return TAB_PATHS.has(path);
}

/**
 * openLink(router, link, segments?)
 *  - tab links switch tab without stacking a second tab bar
 *  - anything else is pushed as usual
 *  Pass `segments` (from useSegments()): it says exactly where we are. The
 *  fallback, router.canDismiss(), is fooled when the screen in front is itself
 *  a (tabs) that got pushed onto the stack — dismissTo then does nothing.
 */
export function openLink(router, link, segments) {
  if (!link) return;
  let href = normalizeLink(link);
  if (!isTabLink(href)) {
    router.push(href);
    return;
  }
  // From outside the tabs, '/' resolves to app/index.js — a <Redirect> that
  // would then put a second (tabs) on the stack. Naming the group resolves
  // to the Feed tab itself, from anywhere.
  if (/^\/(?=[?#]|$)/.test(href)) href = `/(tabs)${href.slice(1)}`;
  const inTabs = segments ? segments[0] === '(tabs)' : !router.canDismiss();
  if (inTabs) router.navigate(href);
  else router.dismissTo(href);
}
