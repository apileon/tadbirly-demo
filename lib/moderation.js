import { supabase } from './supabase';

// File a report against a post or a user.
export async function reportContent({ postId, reportedUserId, reason }) {
  const { data: auth } = await supabase.auth.getUser();
  return supabase.from('reports').insert({
    reporter_id: auth.user.id,
    post_id: postId ?? null,
    reported_user_id: reportedUserId ?? null,
    reason: reason ?? null,
  });
}

// Block a user so their posts disappear from your feed.
export async function blockUser(blockedId) {
  const { data: auth } = await supabase.auth.getUser();
  return supabase.from('blocks').insert({ blocker_id: auth.user.id, blocked_id: blockedId });
}

// Permanently delete the signed-in account (calls the edge function).
export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account');
  if (error) throw error;
  await supabase.auth.signOut();
  return data;
}
