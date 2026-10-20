import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
import { sendPersonal } from '../../_lib/notify.js';

// 💬 Trader-wise notification: Sir sends a message to one or more chosen traders.
// GET  /api/admin/messages[?userId=..]  (admin) -> messages sent, newest first, with read status
// POST /api/admin/messages { userIds:[], title, body, cta } (admin) -> saved to each trader's inbox + push to their phones
const CTA_URL = { log: '/#log', notes: '/#notes', history: '/#history', challenge: '/#challenge', competition: '/#competition', analysis: '/#analysis', '': '/#copilot' };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
export async function onRequestGet({ request, env }) {
  try {
    const me = await getUserFromRequest(request, env);
    if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const uid = new URL(request.url).searchParams.get('userId');
    const q = `SELECT m.*, u.name, u.email FROM trader_messages m JOIN users u ON u.id = m.user_id ${uid ? 'WHERE m.user_id = ?' : ''} ORDER BY m.created_at DESC LIMIT 100`;
    const { results } = await (uid ? env.DB.prepare(q).bind(uid) : env.DB.prepare(q)).all();
    return json({ messages: (results || []).map(r => ({ id: r.id, userId: r.user_id, name: r.name || r.email.split('@')[0], email: r.email, title: r.title, body: r.body, cta: r.cta, createdAt: r.created_at, readAt: r.read_at || null, devices: r.devices || 0 })) });
  } catch (e) { console.error('admin messages get', e); return json({ error: 'Load nahi hua.' }, { status: 500 }); }
}
export async function onRequestPost({ request, env }) {
  try {
    const me = await getUserFromRequest(request, env);
    if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const b = await readJson(request) || {};
    const ids = [...new Set((Array.isArray(b.userIds) ? b.userIds : []).map(String))].slice(0, 300);
    const title = clip(b.title, 80), body = clip(b.body, 500), cta = Object.hasOwn(CTA_URL, b.cta || '') ? (b.cta || '') : '';
    if (!ids.length) return json({ error: 'Kam se kam ek trader chuno.' }, { status: 400 });
    if (title.length < 2) return json({ error: 'Title likho.' }, { status: 400 });
    const now = new Date().toISOString(), out = { sent: 0, withPush: 0, devices: 0, noPush: [], missing: 0 };
    for (const id of ids) {
      const u = await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(id).first();
      if (!u) { out.missing++; continue; }
      const first = String(u.name || u.email.split('@')[0]).trim().split(/\s+/)[0];
      const fill = s => s.replace(/\{name\}/gi, first);   // {name} -> trader's first name
      const mid = crypto.randomUUID(), t = fill(title), tx = fill(body);
      const devices = await sendPersonal(env, u.id, { title: `💬 ${t}`, body: tx || 'Sir ka message — tap karke dekho.', url: CTA_URL[cta], tag: 'msg-' + mid }).catch(() => 0);
      await env.DB.prepare('INSERT INTO trader_messages (id, user_id, title, body, cta, created_at, sent_by, read_at, devices) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)').bind(mid, u.id, t, tx, cta, now, me.id, devices).run();
      out.sent++; out.devices += devices; if (devices) out.withPush++; else out.noPush.push(u.name || u.email);
    }
    return json(out);
  } catch (e) { console.error('admin messages post', e); return json({ error: 'Message nahi gaya.' }, { status: 500 }); }
}
