import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';

// GET  /api/quotes            -> { today, recent[] }   (any logged-in trader)
// POST /api/quotes {text, author} -> new Quote of the Day (admin)
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const limit = Math.min(60, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 10));
    const { results } = await env.DB.prepare('SELECT id, text, author, created_at, notified FROM quotes ORDER BY created_at DESC LIMIT ?').bind(limit).all();
    const quotes = results.map(r => ({ id: r.id, text: r.text, author: r.author, createdAt: r.created_at, notified: r.notified }));
    const extra = isAdminUser(user, env) ? { subscribers: (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first())?.n || 0 } : {};
    return json({ today: quotes[0] || null, recent: quotes, ...extra });
  } catch (e) {
    console.error('quotes get', e);
    return json({ error: 'Quote load nahi hua.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin quote daal sakta hai.' }, { status: 403 });
    await ensureSchema(env);
    const body = await readJson(request);
    const text = String(body?.text || '').trim().slice(0, 500), author = String(body?.author || '').trim().slice(0, 80);
    if (text.length < 3) return json({ error: 'Quote likho.' }, { status: 400 });
    const q = { id: crypto.randomUUID(), text, author, createdAt: new Date().toISOString(), notified: 0 };
    await env.DB.prepare('INSERT INTO quotes (id, text, author, created_at, created_by) VALUES (?, ?, ?, ?, ?)').bind(q.id, q.text, q.author, q.createdAt, user.id).run();
    const subs = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first();
    return json({ quote: q, subscribers: subs?.n || 0 });
  } catch (e) {
    console.error('quotes post', e);
    return json({ error: 'Quote save nahi hua.' }, { status: 500 });
  }
}
