import { getUserFromRequest, json, ensureSchema } from '../../../_lib/auth.js';
// POST /api/competition-entries/<id>/clap -> toggle 👏 for disciplined trades (not on your own)
export async function onRequestPost({ request, env, params }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  await ensureSchema(env);
  const e = await env.DB.prepare(`SELECT id, user_id FROM competition_entries WHERE id = ? AND status = 'ok'`).bind(String(params.id)).first();
  if (!e) return json({ error: 'Entry nahi mili.' }, { status: 404 });
  if (e.user_id === user.id) return json({ error: 'Apni entry par clap nahi.' }, { status: 400 });
  const had = await env.DB.prepare('SELECT 1 AS x FROM competition_claps WHERE entry_id = ? AND user_id = ?').bind(e.id, user.id).first();
  if (had) await env.DB.prepare('DELETE FROM competition_claps WHERE entry_id = ? AND user_id = ?').bind(e.id, user.id).run();
  else await env.DB.prepare('INSERT INTO competition_claps (entry_id, user_id) VALUES (?, ?)').bind(e.id, user.id).run();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM competition_claps WHERE entry_id = ?').bind(e.id).first();
  return json({ clapped: !had, claps: n?.n || 0 });
}
