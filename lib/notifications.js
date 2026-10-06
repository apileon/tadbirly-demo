import { supabase } from './supabase';
import { t } from './i18n';

export async function listNotifications(limit = 60) {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function unreadCount() {
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null);
  return count ?? 0;
}

export async function markRead(id) {
  return supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
}

export async function markAllRead() {
  return supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
}

export async function clearAll() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { error: { message: t('Not signed in') } };
  return supabase.from('notifications').delete().eq('user_id', uid);
}

export const ICONS = {
  message: '💬',
  friend_request: '🤝',
  friend_accepted: '🤝',
  new_application: '📋',
  accepted: '🟢',
  rejected: '🔴',
  team_invite: '🧩',
  team_request: '🧩',
  team_joined: '🧩',
  team_approved: '✅',
  team_rejected: '❌',
  team_application: '🧩',
  team_accepted: '🟢',
  award: '🏅',
  reminder: '⏰',
};
