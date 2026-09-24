import { getUserFromRequest, json } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const user = await getUserFromRequest(request, env);
  return json({ user: user || null });
}
