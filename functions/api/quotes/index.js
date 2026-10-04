import { getUserFromRequest, json, readJson, ensureSchema } from '../../_lib/auth.js';
import { getVapidKeys } from '../../_lib/push.js';

// GET    /api/push           -> { publicKey }  (VAPID key for pushManager.subscribe)
// POST   /api/push { endpoint } -> save this device for notifications
// DELETE /api/push { endpoint } -> stop notifications on this device
export async function onRequestGet({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  await ensureSchema(env);
  const keys = await getVapidKeys(env);
  return json({ publicKey: keys.publicKey });
}
export async function onRequestPost({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  await ensureSchema(env);
  const body = await readJson(request);
  let endpoint = String(body?.endpoint || '');
  try { const u = new URL(endpoint); if (u.protocol !== 'https:' && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) throw 0; } catch { return json({ error: 'Galat subscription.' }, { status: 400 }); }
  await env.DB.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, fails = 0`)
    .bind(endpoint, user.id, new Date().toISOString()).run();
  return json({ ok: true });
}
export async function onRequestDelete({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  await ensureSchema(env);
  const body = await readJson(request);
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(String(body?.endpoint || ''), user.id).run();
  return json({ ok: true });
}
