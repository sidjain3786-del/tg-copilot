import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
import { getChalConfig, saveChalConfig, norm } from '../../_lib/challenge.js';

// GET /api/challenge/config -> admin's 100 Trades Challenge strategies (everyone)
// PUT /api/challenge/config { strategies, allowOwn } (admin) — kept apart from competition strategies
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    return json({ config: await getChalConfig(env) });
  } catch (e) { console.error('chal config get', e); return json({ error: 'Load nahi hua.' }, { status: 500 }); }
}
export async function onRequestPut({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const b = await readJson(request) || {};
    // a challenge strategy must not share its name with a running / upcoming competition — that is what caused the mix-up
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare('SELECT strategy FROM competitions WHERE end_date >= ?').bind(today).all();
    const comp = new Set((results || []).map(r => norm(r.strategy)));
    const clash = (Array.isArray(b.strategies) ? b.strategies : []).find(s => comp.has(norm(s?.name)));
    if (clash) return json({ error: `“${clash.name}” naam competition ki strategy ka hai. Challenge strategy ka naam alag rakho (jaise “${clash.name} — 100 Trades”).` }, { status: 400 });
    // a strategy that running challenges use can't be renamed or deleted (their trades are matched by name) — switch it off instead
    const prev = await getChalConfig(env), next = new Map((Array.isArray(b.strategies) ? b.strategies : []).map(x => [String(x?.id || ''), x]));
    for (const old of prev.strategies) {
      const nx = next.get(old.id); if (nx && norm(nx.name) === norm(old.name)) continue;
      const used = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM trade_challenges WHERE status = 'active' AND instr(extras, ?) > 0`).bind(`"strategyId":"${old.id}"`).first())?.n || 0;
      if (used) return json({ error: `“${old.name}” par ${used} trader${used > 1 ? 's' : ''} ka challenge chal raha hai — iska naam badal / delete nahi kar sakte. Chahiye to “Band karo” (naye challenges ke liye chhup jayegi).` }, { status: 400 });
    }
    return json({ config: await saveChalConfig(env, b) });
  } catch (e) { console.error('chal config put', e); return json({ error: 'Save nahi hua.' }, { status: 500 }); }
}
