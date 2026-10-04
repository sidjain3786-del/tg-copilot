import { getUserFromRequest, json, ensureSchema, isAdminUser, parseColumn } from '../../../_lib/auth.js';
import { journalStats } from '../../../_lib/stats.js';
import { deleteTrader } from '../../../_lib/admin-delete.js';

// GET /api/admin/users/<id>  (admin only) -> one trader's full journal (read-only).
export async function onRequestGet({ request, env, params }) {
  try {
    const me = await getUserFromRequest(request, env);
    if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const id = String(params.id);
    const u = await env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').bind(id).first();
    if (!u) return json({ error: 'Trader nahi mila.' }, { status: 404 });
    const d = await env.DB.prepare('SELECT trades, notes, custom_strategies, updated_at FROM user_data WHERE user_id = ?').bind(id).first();
    const a = await env.DB.prepare('SELECT last_seen_at, last_save_at, saves, visits FROM user_activity WHERE user_id = ?').bind(id).first();
    const s = await env.DB.prepare('SELECT notes FROM user_session_notes WHERE user_id = ?').bind(id).first();
    const trades = parseColumn(d?.trades || '[]', []), notes = parseColumn(d?.notes || '[]', []);
    return json({
      user: { id: u.id, email: u.email, name: u.name, createdAt: u.created_at, lastSeenAt: a?.last_seen_at || null, lastSaveAt: a?.last_save_at || d?.updated_at || null, visits: a?.visits || 0, saves: a?.saves || 0 },
      stats: journalStats(Array.isArray(trades) ? trades : [], notes),
      trades: Array.isArray(trades) ? trades : [], notes: Array.isArray(notes) ? notes : [],
      customStrategies: parseColumn(d?.custom_strategies || '[]', []),
      sessionNotes: parseColumn(s?.notes || '{}', {})
    });
  } catch (e) {
    console.error('admin user error', e);
    return json({ error: 'Trader ka journal load nahi hua.' }, { status: 500 });
  }
}

// DELETE /api/admin/users/<id>  (admin only) -> remove the trader and all their data.
export async function onRequestDelete({ request, env, params }) {
  try {
    const me = await getUserFromRequest(request, env);
    if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const r = await deleteTrader(env, me, String(params.id));
    return json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    console.error('admin delete error', e);
    return json({ error: 'Delete nahi hua.' }, { status: 500 });
  }
}
