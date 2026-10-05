import { Alert, Platform } from 'react-native';

// Cross-platform message. React Native's Alert is a no-op on web,
// so on web we fall back to the browser dialog. Natively it's a real
// Alert.alert (iOS / Android system dialog).
export function notify(title, message) {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.alert) return; // static render
    // eslint-disable-next-line no-alert
    window.alert([title, message].filter(Boolean).join('\n\n'));
  } else {
    // An empty title is allowed; an empty message is passed as undefined so
    // Android doesn't draw a blank body line.
    Alert.alert(title || '', message || undefined);
  }
}

// Cross-platform yes/no confirm. Resolves true if the user confirms.
export function confirmAsync(title, message, confirmText = 'OK') {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.confirm) return Promise.resolve(false);
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm([title, message].filter(Boolean).join('\n\n')));
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    Alert.alert(title || '', message || undefined, [
      { text: 'Cancel', style: 'cancel', onPress: () => finish(false) },
      { text: confirmText, onPress: () => finish(true) },
    ], {
      // Android: tapping outside / Back dismisses — count that as "Cancel"
      // instead of leaving the promise pending forever.
      cancelable: true,
      onDismiss: () => finish(false),
    });
  });
}
