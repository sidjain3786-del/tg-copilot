import { isAdminUser } from './auth.js';
// Deletes a trader completely: login sessions, journal, activity, account and their chart images in R2.
export async function deleteTrader(env, me, id) {
  const u = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(id).first();
  if (!u) return { id, ok: false, error: 'Nahi mila' };
  if (u.id === me.id) return { id, ok: false, error: 'Apna khud ka account delete nahi kar sakte' };
  if (isAdminUser(u, env)) return { id, ok: false, error: 'Admin account delete nahi hota' };
  const run = sql => env.DB.prepare(sql).bind(u.id).run().catch(() => null);   // older DBs may miss a table
  await run('DELETE FROM sessions WHERE user_id = ?');
  await run('DELETE FROM user_data WHERE user_id = ?');
  await run('DELETE FROM user_session_notes WHERE user_id = ?');
  await run('DELETE FROM user_activity WHERE user_id = ?');
  await run('DELETE FROM push_subscriptions WHERE user_id = ?');
  let compImages = [];
  try { compImages = (await env.DB.prepare(`SELECT image FROM competition_entries WHERE user_id = ? AND image != ''`).bind(u.id).all()).results || []; } catch (_) {}
  await run('DELETE FROM competition_claps WHERE entry_id IN (SELECT id FROM competition_entries WHERE user_id = ?)');
  await run('DELETE FROM competition_claps WHERE user_id = ?');
  await run('DELETE FROM competition_entries WHERE user_id = ?');
  await env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(u.email).run().catch(() => null);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id).run();
  let images = 0;
  if (env.IMAGES) {
    try {
      let cursor;
      do {
        const page = await env.IMAGES.list({ prefix: `${u.id}/`, cursor, limit: 1000 });
        const keys = page.objects.map(o => o.key);
        if (keys.length) { await env.IMAGES.delete(keys); images += keys.length; }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      for (const r of compImages) await env.IMAGES.delete(`comp/${String(r.image).replace('/api/comp-img/', '')}`);
    } catch (e) { console.error('image cleanup', e); }
  }
  return { id, ok: true, email: u.email, name: u.name, images };
}
