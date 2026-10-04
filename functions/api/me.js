import { getUserFromRequest, json, isAdminUser } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const user = await getUserFromRequest(request, env);
  return json({ user: user ? { ...user, isAdmin: isAdminUser(user, env) } : null });
}
