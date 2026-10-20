import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser, parseColumn } from '../../_lib/auth.js';
import { progress, rowToChallenge, splitTrades, STAGES, parse } from '../../_lib/challenge.js';
import { sendPersonal } from '../../_lib/notify.js';

// GET /api/challenge/all (admin) -> every trader's current challenge with progress, plus restarts
export async function onRequestGet({ request, env }) {
  try {
    const me = await getUserFromRequest(request, env);
    if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const { results: rows } = await env.DB.prepare(`SELECT c.*, u.name, u.email, d.trades FROM trade_challenges c JOIN users u ON u.id = c.user_id LEFT JOIN user_data d ON d.user_id = c.user_id ORDER BY c.started_at DESC`).all();
    const by = new Map();
    for (const r of rows) {
      const g = by.get(r.user_id) || { userId: r.user_id, name: r.name || r.email.split('@')[0], email: r.email, current: null, restarts: 0, completed: 0, stopped: 0 };
      const ch = rowToChallenge(r);
      if (ch.status === 'restarted') g.restarts++; else if (ch.status === 'completed') g.completed++; else if (ch.status === 'stopped') g.stopped++;
      if (!g.current && (ch.status === 'active' || ch.status === 'completed')) {
        const trades = parseColumn(r.trades || '[]', []), p = progress(ch, trades), { inside } = splitTrades(ch, trades);
        g.current = { ...ch, ...p, lastTradeAt: inside.length ? (inside[inside.length - 1].date || null) : null };
      }
      by.set(r.user_id, g);
    }
    return json({ traders: [...by.values()] });
  } catch (e) { console.error('challenge all', e); return json({ error: 'Load nahi hua.' }, { status: 500 }); }
}

// POST /api/challenge/all (admin) { action: 'feedback', challengeId, stage, text } -> Sir's comment on a review; the trader gets a notification
export async function onRequestPost({ request, env }) {
  try {
    const me = await getUserFromRequest(request, env);
    if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const b = await readJson(request) || {};
    if (b.action !== 'feedback') return json({ error: 'Unknown action' }, { status: 400 });
    const row = await env.DB.prepare('SELECT id, user_id, feedback, reviews FROM trade_challenges WHERE id = ?').bind(String(b.challengeId || '')).first();
    if (!row) return json({ error: 'Challenge nahi mila.' }, { status: 404 });
    const key = String(b.stage), text = String(b.text || '').trim().slice(0, 600);
    if (!(STAGES.map(String).includes(key) || /^c\d0$/.test(key))) return json({ error: 'Galat stage.' }, { status: 400 });
    const fb = parse(row.feedback, {});
    if (!text) delete fb[key]; else fb[key] = { text, at: new Date().toISOString(), by: me.name || 'Sir' };
    await env.DB.prepare('UPDATE trade_challenges SET feedback = ? WHERE id = ?').bind(JSON.stringify(fb), row.id).run();
    let sent = 0;
    if (text) sent = await sendPersonal(env, row.user_id, { title: '💬 Sir ne aapke review par feedback diya', body: text, url: '/#challenge', tag: 'challenge-feedback' });
    return json({ ok: true, feedback: fb, sent });
  } catch (e) { console.error('challenge feedback', e); return json({ error: 'Save nahi hua.' }, { status: 500 }); }
}
