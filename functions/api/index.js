import { getUserFromRequest, json, ensureSchema, isAdminUser, parseColumn } from '../../../_lib/auth.js';
import { journalStats } from '../../../_lib/stats.js';

// GET /api/admin/users  (admin only) -> every trader with progress numbers.
export async function onRequestGet({ request, env }) {
  try {
    const me = await getUserFromRequest(request, env);
    if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const { results } = await env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.created_at, d.trades, d.notes, d.updated_at,
             a.last_seen_at, a.last_save_at, a.saves, a.visits
      FROM users u LEFT JOIN user_data d ON d.user_id = u.id LEFT JOIN user_activity a ON a.user_id = u.id
      ORDER BY COALESCE(a.last_seen_at, d.updated_at, u.created_at) DESC`).all();
    const now = Date.now();
    const users = results.map(r => {
      const trades = parseColumn(r.trades || '[]', []), notes = parseColumn(r.notes || '[]', []);
      return {
        id: r.id, email: r.email, name: r.name, createdAt: r.created_at,
        lastSeenAt: r.last_seen_at || null, lastSaveAt: r.last_save_at || r.updated_at || null,
        visits: r.visits || 0, saves: r.saves || 0, isAdmin: isAdminUser(r, env),
        ...journalStats(Array.isArray(trades) ? trades : [], notes, now)
      };
    });
    return json({ users, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error('admin users error', e);
    return json({ error: 'Traders ka data load nahi hua.' }, { status: 500 });
  }
}
