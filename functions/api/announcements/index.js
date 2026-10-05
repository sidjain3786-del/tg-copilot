import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';

// GET  /api/announcements           -> active announcements (not expired). Admin: ?all=1 includes old ones.
// POST /api/announcements {title, body, cta, style, days} (admin)
const STYLES = new Set(['info', 'important', 'celebrate']);
const CTAS = new Set(['', 'log', 'notes', 'history', 'blog', 'report', 'analysis']);
const toAnn = r => ({ id: r.id, title: r.title, body: r.body, cta: r.cta, style: r.style, createdAt: r.created_at, expiresAt: r.expires_at, active: !!r.active, notified: r.notified });

export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const all = isAdminUser(user, env) && new URL(request.url).searchParams.get('all') === '1';
    const now = new Date().toISOString();
    const { results } = all
      ? await env.DB.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 30').all()
      : await env.DB.prepare('SELECT * FROM announcements WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 5').bind(now).all();
    return json({ announcements: results.map(toAnn) });
  } catch (e) {
    console.error('ann get', e);
    return json({ error: 'Announcements load nahi hue.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin announcement kar sakta hai.' }, { status: 403 });
    await ensureSchema(env);
    const b = await readJson(request);
    const title = String(b?.title || '').trim().slice(0, 120), body = String(b?.body || '').trim().slice(0, 600);
    if (title.length < 2) return json({ error: 'Announcement ka title likho.' }, { status: 400 });
    const cta = CTAS.has(b?.cta) ? b.cta : '', style = STYLES.has(b?.style) ? b.style : 'info';
    const days = Number(b?.days) || 0, now = new Date();
    const a = { id: crypto.randomUUID(), title, body, cta, style, createdAt: now.toISOString(), expiresAt: days > 0 ? new Date(now.getTime() + days * 86400000).toISOString() : null, active: true, notified: 0 };
    await env.DB.prepare('INSERT INTO announcements (id, title, body, cta, style, created_at, expires_at, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
      .bind(a.id, a.title, a.body, a.cta, a.style, a.createdAt, a.expiresAt, user.id).run();
    const subs = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first();
    return json({ announcement: a, subscribers: subs?.n || 0 });
  } catch (e) {
    console.error('ann post', e);
    return json({ error: 'Announcement save nahi hua.' }, { status: 500 });
  }
}
