import { Alert, Platform } from 'react-native';
import { toast, showDialog } from '../components/Toast';
import { t } from './i18n';
import uz from './locales/uz';
import ru from './locales/ru';

// ---------------------------------------------------------------------------
//  notify(title, body?, opts?) — tell the user something.
//
//  Short, informational messages ("Saved", "Application sent", a quick
//  "Add a title") show as an in-app toast that slides in and goes away by
//  itself. A real dialog is kept for what has to be read:
//    • failures ("Could not …"), which usually carry the server's reason
//    • a long body (> 120 characters), a multi-line body, or a link to copy
//    • step-by-step help (how to switch notifications on, …)
//    • opts.dialog === true, for callers that must block
//  opts.dialog === false forces a toast; opts.type ('success' | 'error' |
//  'info') overrides the icon.
//
//  Web: the dialog is Tadbirly's own (components/Toast.js), not the browser's.
//  Phone app: the dialog is the system Alert.
// ---------------------------------------------------------------------------

const TOAST_BODY_MAX = 120;

// Titles reach notify() already translated. To recognise the kind of message
// in any language, map a translation back to its English key.
let reverse = null;
function englishOf(s) {
  if (!s) return '';
  if (!reverse) {
    reverse = new Map();
    for (const dict of [uz, ru]) {
      for (const [en, tr] of Object.entries(dict)) if (tr && !reverse.has(tr)) reverse.set(tr, en);
    }
  }
  return reverse.get(s) ?? s;
}

const FAILURE = /^(Could not|Couldn['’]t|Can['’]t|Cannot)\b/;
// Step-by-step help (lib/feedback notificationHelp & co.): people follow it
// while reading, so it stays up until they close it.
const HOW_TO = /^(Notifications are blocked|Add Tadbirly to your Home Screen|Update your iPhone|This browser can['’]t show notifications|Open Tadbirly in your browser|Notification status|Copy this link)/;
const PROBLEM = /^(Image too large|Message too long|Title is too long|Details are too long|Date is in the past|Invalid|Pin limit|Check |Already |Team too small|Team not approved|That['’]s enough|That['’]s your event|Not enabled|Notifications are off|Photos unavailable|Name the|Name your|Pick a|Add a|Add the|Add your|Enter |Write something|Admins only|Only )/;
const SUCCESS = /(^Saved|^Published|^Posted|^Thanks|^Event ended|^Marked as|^Team (accepted|approved|applied|created|deleted)|^You joined|^You are now friends|^Friends$|^Unblocked|^Blocked|^Link copied|^Copied|^Notifications on|^Account deleted|^Report sent|^You left|updated$|sent$|created$|deleted$|accepted$)/;

function showAlert(title, body) {
  if (Platform.OS === 'web') {
    const shown = showDialog({ title, body, buttons: [{ text: t('OK'), style: 'primary', value: true }] });
    if (shown) return;
    if (typeof window === 'undefined' || !window.alert) return; // static render
    // eslint-disable-next-line no-alert
    window.alert([title, body].filter(Boolean).join('\n\n'));
    return;
  }
  // An empty title is allowed; an empty message is passed as undefined so
  // Android doesn't draw a blank body line.
  Alert.alert(title || '', body || undefined);
}

export function notify(title, message, opts = {}) {
  const head = String(title ?? '').trim();
  const body = String(message ?? '').trim();
  if (!head && !body) return;
  const key = englishOf(head);

  const failure = FAILURE.test(key);
  const needsReading = body.length > TOAST_BODY_MAX || body.includes('\n') || /https?:\/\//.test(body);
  const dialog = opts.dialog === true
    || (opts.dialog !== false && (failure || needsReading || HOW_TO.test(key)));

  if (dialog) { showAlert(head, body); return; }

  const type = opts.type
    || (failure || PROBLEM.test(key) ? 'error' : SUCCESS.test(key) ? 'success' : 'info');
  toast(head || body, { body: head ? body : '', type });
}

const DESTRUCTIVE = /^(Delete|Remove|Disconnect|Reject|Clear|Block|Leave|Report|Unfriend)/;

// Cross-platform yes/no confirm. Resolves true if the user confirms.
// opts.destructive colours the confirm button red; by default it's decided
// from the label ("Delete", "Remove", …).
export function confirmAsync(title, message, confirmText, opts = {}) {
  const label = confirmText || t('OK');
  const destructive = opts.destructive ?? DESTRUCTIVE.test(englishOf(label));

  if (Platform.OS === 'web') {
    const shown = showDialog({
      title,
      body: message,
      buttons: [
        { text: t('Cancel'), style: 'cancel', value: false },
        { text: label, style: destructive ? 'destructive' : 'primary', value: true },
      ],
    });
    if (shown) return shown.then((v) => v === true);
    if (typeof window === 'undefined' || !window.confirm) return Promise.resolve(false);
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm([title, message].filter(Boolean).join('\n\n')));
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    Alert.alert(title || '', message || undefined, [
      { text: t('Cancel'), style: 'cancel', onPress: () => finish(false) },
      { text: label, style: destructive ? 'destructive' : 'default', onPress: () => finish(true) },
    ], {
      // Android: tapping outside / Back dismisses — count that as "Cancel"
      // instead of leaving the promise pending forever.
      cancelable: true,
      onDismiss: () => finish(false),
    });
  });
}
