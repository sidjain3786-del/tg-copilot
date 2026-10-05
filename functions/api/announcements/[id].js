import { getUserFromRequest, json, ensureSchema, isAdminUser } from '../../_lib/auth.js';
// DELETE /api/announcements/<id> (admin) -> take it down
export async function onRequestDelete({ request, env, params }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
  await ensureSchema(env);
  await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(String(params.id)).run();
  return json({ ok: true });
}
