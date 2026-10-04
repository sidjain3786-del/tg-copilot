import { getUserFromRequest, json, isAdminUser, touchActivity } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (user) await touchActivity(env, user.id, 'visit');
  return json({ user: user ? { ...user, isAdmin: isAdminUser(user, env) } : null });
}
