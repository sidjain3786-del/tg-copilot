import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
import { getVapidKeys, sendTickle } from '../../_lib/push.js';

// POST /api/quotes/notify { quoteId, offset }  (admin)
// Sends push notifications in batches of 40 (Cloudflare limits outgoing requests per call);
// the admin screen keeps calling with the returned nextOffset until done.
const BATCH = 40;
export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const body = await readJson(request);
    const offset = Math.max(0, Number(body?.offset) || 0);
    const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first())?.n || 0;
    const { results } = await env.DB.prepare('SELECT endpoint FROM push_subscriptions ORDER BY created_at LIMIT ? OFFSET ?').bind(BATCH, offset).all();
    const keys = await getVapidKeys(env);
    const subject = `mailto:${String(env.ADMIN_EMAILS || 'admin@example.com').split(',')[0].trim()}`;
    let sent = 0, gone = 0, failed = 0;
    const now = new Date().toISOString();
    for (const { endpoint } of results) {
      const r = await sendTickle(endpoint, keys, subject);
      if (r === 'ok') { sent++; await env.DB.prepare('UPDATE push_subscriptions SET last_ok_at = ?, fails = 0 WHERE endpoint = ?').bind(now, endpoint).run(); }
      else if (r === 'gone') { gone++; await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run(); }
      else { failed++; await env.DB.prepare('UPDATE push_subscriptions SET fails = fails + 1 WHERE endpoint = ?').bind(endpoint).run(); }
    }
    if (body?.quoteId && sent) await env.DB.prepare('UPDATE quotes SET notified = notified + ? WHERE id = ?').bind(sent, String(body.quoteId)).run();
    // expired subscriptions were deleted, so the next page starts earlier by that many
    const nextOffset = offset + results.length - gone;
    return json({ sent, gone, failed, total, nextOffset, done: results.length < BATCH });
  } catch (e) {
    console.error('notify error', e);
    return json({ error: 'Notification nahi gaye.' }, { status: 500 });
  }
}
