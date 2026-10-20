// A notification meant for ONE trader (Sir's feedback, a challenge nudge).
// It waits in user_prefs.pending; the phone asks /api/notify/latest and gets it first.
import { getVapidKeys, sendTickle } from './push.js';
export async function sendPersonal(env, userId, msg, { respectOff = false } = {}) {
  if (respectOff) { const p = await env.DB.prepare('SELECT reminders_off FROM user_prefs WHERE user_id = ?').bind(userId).first(); if (p?.reminders_off) return 0; }
  const payload = JSON.stringify({ title: String(msg.title || '').slice(0, 80), body: String(msg.body || '').slice(0, 300), url: msg.url || '/', tag: msg.tag || 'personal', at: new Date().toISOString() });
  await env.DB.prepare('INSERT INTO user_prefs (user_id, reminders_off, pending) VALUES (?, 0, ?) ON CONFLICT(user_id) DO UPDATE SET pending = excluded.pending').bind(userId, payload).run();
  const { results } = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ? LIMIT 10').bind(userId).all();
  if (!results?.length) return 0;
  const keys = await getVapidKeys(env), subject = `mailto:${String(env.ADMIN_EMAILS || 'admin@example.com').split(',')[0].trim()}`;
  let sent = 0;
  for (const { endpoint } of results) { const r = await sendTickle(endpoint, keys, subject); if (r === 'ok') sent++; else if (r === 'gone') await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run(); }
  return sent;
}
// called by /api/notify/latest: a fresh personal message wins (and is then cleared)
export async function takePersonal(env, userId) {
  const row = await env.DB.prepare('SELECT pending FROM user_prefs WHERE user_id = ?').bind(userId).first();
  if (!row?.pending) return null;
  let m = null; try { m = JSON.parse(row.pending); } catch {}
  await env.DB.prepare('UPDATE user_prefs SET pending = NULL WHERE user_id = ?').bind(userId).run();
  if (!m || Date.now() - Date.parse(m.at || 0) > 12 * 3600000) return null;
  return { title: m.title, body: m.body, url: m.url, tag: m.tag };
}
