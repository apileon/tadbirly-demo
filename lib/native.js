import { Platform, UIManager } from 'react-native';

// Is this native view compiled into the installed app? New native modules
// (maps, QR codes, camera) only exist in builds made after they were added;
// an older store build would crash drawing them, so screens check first.
// The web has everything.
export function hasNativeView(name) {
  if (Platform.OS === 'web') return true;
  try {
    return !!(UIManager.hasViewManagerConfig?.(name) ?? UIManager.getViewManagerConfig?.(name));
  } catch {
    return false;
  }
}

export const canShowMap = () => hasNativeView('RNCWebView');
export const canDrawQr = () => hasNativeView('RNSVGPath');
export const canUseCamera = () => hasNativeView('ExpoCamera') || hasNativeView('ExpoCameraView');
