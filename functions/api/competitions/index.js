import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
import { compToJson, normCriteria, aliasFor, weeksOf } from '../../_lib/competition.js';

// GET  /api/competitions -> list (newest first) with my anonymous name + my entry count
// POST /api/competitions (admin) -> create a competition on Sir's strategy
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const { results } = await env.DB.prepare('SELECT * FROM competitions ORDER BY start_date DESC, created_at DESC LIMIT 20').all();
    const { results: counts } = await env.DB.prepare(`SELECT competition_id AS c, COUNT(*) AS n, COUNT(DISTINCT user_id) AS p, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine FROM competition_entries WHERE status = 'ok' GROUP BY competition_id`).bind(user.id).all();
    const by = Object.fromEntries((counts || []).map(r => [r.c, r]));
    const out = [];
    for (const r of results) out.push(compToJson(r, { entries: by[r.id]?.n || 0, participants: by[r.id]?.p || 0, myEntries: by[r.id]?.mine || 0, myAlias: await aliasFor(user.id, r.id) }));
    return json({ competitions: out });
  } catch (e) { console.error('comp list', e); return json({ error: 'Competition load nahi hua.' }, { status: 500 }); }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin competition bana sakta hai.' }, { status: 403 });
    await ensureSchema(env);
    const v = validate(await readJson(request)); if (v.error) return json({ error: v.error }, { status: 400 });
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO competitions (id, title, strategy, description, rules, entry_criteria, exit_criteria, start_date, end_date, criteria, status, created_at, created_by, prize_weekly, prize_final, week_results) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, '{}')`)
      .bind(id, v.title, v.strategy, v.description, JSON.stringify(v.rules), v.entryCriteria, v.exitCriteria, v.startDate, v.endDate, JSON.stringify(v.criteria), now, user.id, v.prizeWeekly, v.prizeFinal).run();
    const row = await env.DB.prepare('SELECT * FROM competitions WHERE id = ?').bind(id).first();
    return json({ competition: compToJson(row, { entries: 0, participants: 0, myEntries: 0, myAlias: await aliasFor(user.id, id) }) });
  } catch (e) { console.error('comp create', e); return json({ error: 'Competition save nahi hua.' }, { status: 500 }); }
}

export function validate(b) {
  const clip = (v, n) => String(v ?? '').trim().slice(0, n);
  const title = clip(b?.title, 120), strategy = clip(b?.strategy, 80);
  const startDate = clip(b?.startDate, 10), endDate = clip(b?.endDate, 10);
  if (title.length < 3) return { error: 'Competition ka naam likho.' };
  if (strategy.length < 2) return { error: 'Strategy ka naam likho.' };
  const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
  if (!okDate(startDate) || !okDate(endDate) || endDate < startDate) return { error: 'Start aur end date sahi chuno.' };
  if (weeksOf(startDate, endDate).length > 14 || (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000 > 92) return { error: 'Competition 3 mahine se lamba nahi ho sakta.' };
  const rules = (Array.isArray(b?.rules) ? b.rules : String(b?.rules || '').split('\n')).map(x => clip(x, 200)).filter(Boolean).slice(0, 15);
  return { title, strategy, startDate, endDate, rules, description: clip(b?.description, 1500), entryCriteria: clip(b?.entryCriteria, 800), exitCriteria: clip(b?.exitCriteria, 800),
    prizeWeekly: clip(b?.prizeWeekly, 120), prizeFinal: clip(b?.prizeFinal, 120), criteria: normCriteria(b?.criteria) };
}
