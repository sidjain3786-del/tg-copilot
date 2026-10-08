import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
// PUT /api/competition-entries/<id> (admin) { status: 'removed' | 'ok', note }
// Admin can take an entry out of the feed and ranking (e.g. the chart doesn't match the strategy) and put it back.
// A trader takes their own trade out by changing its strategy, or deleting it, in their journal.
export async function onRequestPut({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const e = await env.DB.prepare('SELECT id FROM competition_entries WHERE id = ?').bind(String(params.id)).first();
    if (!e) return json({ error: 'Entry nahi mili.' }, { status: 404 });
    const b = await readJson(request) || {}, status = b.status === 'removed' ? 'removed' : 'ok';
    await env.DB.prepare('UPDATE competition_entries SET status = ?, admin_note = ? WHERE id = ?').bind(status, status === 'removed' ? String(b.note || '').trim().slice(0, 200) : '', e.id).run();
    if (status === 'removed') await env.DB.prepare('DELETE FROM competition_claps WHERE entry_id = ?').bind(e.id).run();
    return json({ ok: true, status });
  } catch (err) { console.error('comp entry put', err); return json({ error: 'Update nahi hua.' }, { status: 500 }); }
}
