// App-wide settings stored in D1 (app_settings table).
export const FEATURE_KEYS = ['risk', 'analysis', 'notes', 'history', 'competition', 'blog', 'playbook', 'report', 'quote', 'announcements', 'voice'];
export async function getFeatures(env) {
  const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'features'`).first();
  let saved = {}; try { saved = row ? JSON.parse(row.value) : {}; } catch {}
  const out = {}; FEATURE_KEYS.forEach(k => { out[k] = saved[k] !== false; });   // everything ON unless switched off
  return out;
}
export async function setLastPush(env, info) {
  await env.DB.prepare(`INSERT INTO app_settings (key, value) VALUES ('last_push', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(info)).run();
}
