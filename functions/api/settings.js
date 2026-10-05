import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../_lib/auth.js';
import { getFeatures, FEATURE_KEYS } from '../_lib/settings.js';

// GET /api/settings -> { features: {risk:true, ...} }      (any logged-in user)
// PUT /api/settings { features: {risk:false} }            (admin) — switch features on/off for everyone
export async function onRequestGet({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  await ensureSchema(env);
  return json({ features: await getFeatures(env) });
}
export async function onRequestPut({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
  await ensureSchema(env);
  const body = await readJson(request);
  const cur = await getFeatures(env);
  FEATURE_KEYS.forEach(k => { if (typeof body?.features?.[k] === 'boolean') cur[k] = body.features[k]; });
  await env.DB.prepare(`INSERT INTO app_settings (key, value) VALUES ('features', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(cur)).run();
  return json({ features: cur });
}
