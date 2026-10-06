import { Alert, Linking, Platform } from 'react-native';
import { supabase } from './supabase';
import { notify } from './notify';
import { t, dateLocale } from './i18n';

const isWeb = Platform.OS === 'web';

// Web: only once there's a DOM (not during static rendering). Native: always —
// the photo library is reached through expo-image-picker.
export const canPickImage = isWeb ? typeof document !== 'undefined' : true;

// The longest side photos are shrunk to, and the JPEG quality, everywhere.
const MAX_DIM = 1600;
const QUALITY = 0.85;

// ---------------------------------------------------------------------------
//  Native helpers (iOS / Android). The modules are required lazily so the web
//  bundle never evaluates them.
// ---------------------------------------------------------------------------

function askForSettings() {
  const how = Platform.OS === 'ios'
    ? t('Open Settings → Tadbirly → Photos and choose “All Photos” or “Selected Photos”.')
    : t('Open Settings → Apps → Tadbirly → Permissions → Photos and videos, and allow access.');
  Alert.alert(t('Allow photo access'), `${t('Tadbirly needs access to your photos to add a picture.')} ${how}`, [
    { text: t('Not now'), style: 'cancel' },
    { text: t('Open Settings'), onPress: () => { Linking.openSettings().catch(() => {}); } },
  ]);
}

// Resizes to MAX_DIM on the longest side and re-encodes as JPEG (which also
// turns iPhone HEIC photos into something the storage buckets accept).
// Returns { uri, width, height } or null if the manipulator failed.
async function nativeResize(src, maxDim = MAX_DIM, quality = QUALITY) {
  try {
    const IM = require('expo-image-manipulator');
    const w = src.width || 0;
    const h = src.height || 0;
    const resize = Math.max(w, h) > maxDim ? (w >= h ? { width: maxDim } : { height: maxDim }) : null;
    const format = IM.SaveFormat ? IM.SaveFormat.JPEG : 'jpeg';
    if (IM.ImageManipulator && typeof IM.ImageManipulator.manipulate === 'function') {
      const ctx = IM.ImageManipulator.manipulate(src.uri);
      if (resize) ctx.resize(resize);
      const ref = await ctx.renderAsync();
      return await ref.saveAsync({ compress: quality, format });
    }
    return await IM.manipulateAsync(src.uri, resize ? [{ resize }] : [], { compress: quality, format });
  } catch {
    return null;
  }
}

async function nativeFileSize(uri) {
  try {
    const FS = require('expo-file-system/legacy');
    const info = await FS.getInfoAsync(uri);
    return info && info.exists && typeof info.size === 'number' ? info.size : 0;
  } catch {
    return 0;
  }
}

// Turns a picked/processed image into the same shape callers already use for
// a web File: { name, type, size } plus { uri, previewUri } for <Image>.
async function toNativeFile(src, { compressed, type } = {}) {
  const size = (await nativeFileSize(src.uri)) || src.fileSize || 0;
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/gif' ? 'gif' : 'jpg';
  return {
    native: true,
    compressed: !!compressed,
    uri: src.uri,
    previewUri: src.uri,
    name: `image.${ext}`,
    type: type || 'image/jpeg',
    size,
    width: src.width || 0,
    height: src.height || 0,
  };
}

async function pickImageNative({ square = false } = {}) {
  let ImagePicker;
  try {
    ImagePicker = require('expo-image-picker');
  } catch {
    notify(t('Photos unavailable'), t('This version of the app can’t open your photos. Please update Tadbirly.'));
    return null;
  }
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm || (!perm.granted && perm.status !== 'granted')) {
      askForSettings();
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: !!square,
      ...(square ? { aspect: [1, 1] } : null),
      quality: QUALITY,
      exif: false,
    });
    if (!result || result.canceled || !result.assets || !result.assets[0]) return null;
    const asset = result.assets[0];
    // Shrink straight away, so the size checks callers do (5 MB buckets) see
    // the size that will actually be uploaded, and the preview is light.
    const out = await nativeResize(asset);
    if (out && out.uri) return toNativeFile(out, { compressed: true, type: 'image/jpeg' });
    return toNativeFile(asset, { compressed: false, type: asset.mimeType || 'image/jpeg' });
  } catch (e) {
    notify(t('Could not open your photos'), (e && e.message) || t('Please try again.'));
    return null;
  }
}

async function readNativeAsArrayBuffer(uri) {
  const FS = require('expo-file-system/legacy');
  const { decode } = require('base64-arraybuffer');
  const b64 = await FS.readAsStringAsync(uri, { encoding: 'base64' });
  return decode(b64);
}

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------

// Opens the device photo picker. On the web (installed web app) this opens
// the camera / gallery on phones via a file input; natively it opens the
// photo library through expo-image-picker.
// Always settles — the picked image, or null when the picker is dismissed or
// photo access was refused. Before, a cancel left the promise pending
// forever, and with it every caller's "Uploading…" spinner.
//
// Options (ignored on the web): { square: true } lets the user crop a square
// (profile pictures).
//
// The result works like a File everywhere (`.size`, `.type`, `.name`) and has
// a `.previewUri` usable as <Image source={{ uri }}>. On the web that's an
// object URL created on first read — free it with releasePreview(file).
export function pickImage(options) {
  if (!isWeb) return pickImageNative(options);
  return pickImageWeb().then(withWebPreview);
}

// Frees a preview made by `.previewUri` (web only; natively it's a no-op).
export function releasePreview(file) {
  if (!isWeb || !file) return;
  try {
    if (file.__previewUri) URL.revokeObjectURL(file.__previewUri);
    file.__previewUri = null;
  } catch { /* ignore */ }
}

function withWebPreview(file) {
  if (!file) return file;
  try {
    Object.defineProperty(file, 'previewUri', {
      configurable: true,
      get() {
        if (!this.__previewUri) this.__previewUri = URL.createObjectURL(this);
        return this.__previewUri;
      },
    });
  } catch { /* ignore — callers can still use the File */ }
  return file;
}

function pickImageWeb() {
  return new Promise((resolve) => {
    if (!canPickImage) return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    let settled = false;
    let timer = null;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('pointerdown', onBack, true);
      resolve(file || null);
    };

    // Fallback for browsers without the 'cancel' event (Chrome < 113,
    // Safari < 16.4): once the page is back in the user's hands and still no
    // file has arrived, the picker was dismissed. The wait matters — on slow
    // phones 'change' can land a few hundred ms after the page regains focus,
    // and giving up too early would silently drop a photo they did pick.
    const onBack = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!input.files || input.files.length === 0) finish(null);
      }, 1000);
    };
    // Only trust 'focus' after the dialog has actually taken focus away, so a
    // stray focus event (e.g. from a confirm() that just closed) can't cancel
    // the pick while the dialog is still open.
    const onBlur = () => window.addEventListener('focus', onBack);

    input.addEventListener('change', () => finish(input.files && input.files[0]));
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener('blur', onBlur);
    // Old iOS Safari fires neither 'cancel' nor window focus when its photo
    // menu is dismissed; the next tap on the page is the only sign.
    document.addEventListener('pointerdown', onBack, true);
    input.click();
  });
}

// Shrinks huge photos before upload so posters load fast. Keeps the original
// shape — only the pixel dimensions come down. Falls back to the raw file.
export async function compressImage(file, maxDim = MAX_DIM, quality = QUALITY) {
  if (!isWeb) {
    // Native picks are already shrunk by pickImage; this only catches an
    // image that came from somewhere else (or whose first resize failed).
    if (!file || !file.native || file.compressed || !file.uri) return file;
    const out = await nativeResize(file, maxDim, quality);
    return out && out.uri ? toNativeFile(out, { compressed: true, type: 'image/jpeg' }) : file;
  }
  if (typeof document === 'undefined' || !file?.type?.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

// Uploads to a public bucket and returns the public URL.
export async function uploadImage(bucket, file) {
  const ext = (file.name && file.name.includes('.') ? file.name.split('.').pop() : 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  // Native: React Native has no File/Blob upload that supabase-js can send
  // reliably, so read the image as base64 and hand Storage an ArrayBuffer.
  const body = !isWeb && file && file.native ? await readNativeAsArrayBuffer(file.uri) : file;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export const uploadNewsImage = (file) => uploadImage('news', file);
export const uploadAvatar = (file) => uploadImage('avatars', file);
export const uploadCover = (file) => uploadImage('covers', file);

// Pick + upload in one step, with a size guard. Returns a URL or null.
// `options` is passed to pickImage (e.g. { square: true }).
export async function pickAndUpload(bucket, maxMb = 12, options) {
  const picked = await pickImage(options);
  if (!picked) return null;
  if (picked.size > maxMb * 1024 * 1024) throw new Error(`Please pick an image under ${maxMb} MB.`);
  const file = await compressImage(picked);
  return uploadImage(bucket, file);
}

export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n}m ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}h ago', { n: Math.floor(s / 3600) });
  if (s < 604800) return t('{n}d ago', { n: Math.floor(s / 86400) });
  return new Date(iso).toLocaleDateString(dateLocale());
}
