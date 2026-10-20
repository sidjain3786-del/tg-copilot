import { getUserFromRequest, json, readJson, ensureSchema } from '../_lib/auth.js';

// 💬 My messages from Sir.  GET -> latest 30 (unread first in the app).  POST { action:'read', ids:[] | 'all' }
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const { results } = await env.DB.prepare('SELECT id, title, body, cta, created_at, read_at FROM trader_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').bind(user.id).all();
    return json({ messages: (results || []).map(r => ({ id: r.id, title: r.title, body: r.body, cta: r.cta, createdAt: r.created_at, readAt: r.read_at || null })) });
  } catch (e) { console.error('messages get', e); return json({ error: 'Load nahi hua.' }, { status: 500 }); }
}
export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const b = await readJson(request) || {}, now = new Date().toISOString();
    if (b.action !== 'read') return json({ error: 'Unknown action' }, { status: 400 });
    if (b.ids === 'all') await env.DB.prepare('UPDATE trader_messages SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now, user.id).run();
    else for (const id of (Array.isArray(b.ids) ? b.ids : []).slice(0, 50)) await env.DB.prepare('UPDATE trader_messages SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').bind(now, String(id), user.id).run();
    return json({ ok: true });
  } catch (e) { console.error('messages post', e); return json({ error: 'Save nahi hua.' }, { status: 500 }); }
}
