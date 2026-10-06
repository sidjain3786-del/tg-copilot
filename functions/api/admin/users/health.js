import { getUserFromRequest, json, ensureSchema, isAdminUser } from '../../_lib/auth.js';

// GET /api/admin/health (admin) -> server-side launch checks: database tables, R2 image storage, admins, push keys.
const TABLES = ['users', 'sessions', 'user_data', 'user_session_notes', 'user_activity', 'login_attempts', 'blog_posts', 'quotes', 'announcements', 'push_subscriptions', 'app_settings'];
export async function onRequestGet({ request, env }) {
  const me = await getUserFromRequest(request, env);
  if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
  if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  try {
    await ensureSchema(env);
    const { results } = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    const have = new Set(results.map(r => r.name)), missing = TABLES.filter(t => !have.has(t));
    add('Database (D1) tables', !missing.length, missing.length ? `Missing: ${missing.join(', ')} — schema.sql chalao` : `${TABLES.length} tables ready`);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    add('Database read/write', true, `${n?.n || 0} accounts`);
  } catch (e) { add('Database (D1)', false, 'D1 binding "DB" nahi mila ya error: ' + (e.message || e)); }
  if (!env.IMAGES) add('Image storage (R2)', false, 'R2 binding "IMAGES" nahi hai — Settings → Bindings → R2 bucket → IMAGES, phir redeploy');
  else {
    try {
      const key = `health/${crypto.randomUUID()}.txt`;
      await env.IMAGES.put(key, 'ok'); const got = await env.IMAGES.get(key); const txt = got ? await got.text() : ''; await env.IMAGES.delete(key);
      add('Image storage (R2)', txt === 'ok', txt === 'ok' ? 'Upload / read / delete chal raha hai' : 'R2 read nahi hua');
    } catch (e) { add('Image storage (R2)', false, String(e.message || e)); }
  }
  const admins = String(env.ADMIN_EMAILS || '').split(',').map(x => x.trim()).filter(Boolean);
  add('Admin emails (ADMIN_EMAILS)', admins.length > 0, admins.length ? admins.join(', ') : 'Set nahi hai');
  try {
    const v = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'vapid'`).first();
    const subs = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first();
    add('Push notifications', true, `${v || env.VAPID_PUBLIC_KEY ? 'Keys ready' : 'Keys pehli notification par banenge'} · ${subs?.n || 0} devices on`);
  } catch (e) { add('Push notifications', false, String(e.message || e)); }
  return json({ checks, time: new Date().toISOString() });
}
