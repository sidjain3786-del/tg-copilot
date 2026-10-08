import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../../_lib/auth.js';
import { normCriteria, leaderboard, weeksOf, weekState, parseJson, userNames, publicWinners } from '../../../_lib/competition.js';

// POST /api/competitions/<id>/declare (admin)
//   { period: 'week', week: '<week start date>', revealNames }  -> weekly winner(s); that week gets locked
//   { period: 'final', revealNames }                            -> month-end / final winners; competition closes
//   { ..., undo: true }                                         -> take that declaration back
export async function onRequestPost({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const c = await env.DB.prepare('SELECT * FROM competitions WHERE id = ?').bind(String(params.id)).first();
    if (!c) return json({ error: 'Competition nahi mila.' }, { status: 404 });
    const b = await readJson(request) || {};
    const crit = normCriteria(parseJson(c.criteria, {})), weekRes = parseJson(c.week_results, {});
    const week = b.period === 'week' ? weeksOf(c.start_date, c.end_date).find(w => w.start === String(b.week)) : null;
    if (b.period === 'week' && !week) return json({ error: 'Yeh hafta is competition mein nahi hai.' }, { status: 400 });

    if (b.undo) {
      if (week) { delete weekRes[week.start]; await env.DB.prepare('UPDATE competitions SET week_results = ? WHERE id = ?').bind(JSON.stringify(weekRes), c.id).run(); }
      else await env.DB.prepare(`UPDATE competitions SET status = 'active', results = NULL, reveal_names = 0 WHERE id = ?`).bind(c.id).run();
      return json({ ok: true });
    }
    if (week && weekState(week) === 'upcoming') return json({ error: 'Yeh hafta abhi shuru nahi hua.' }, { status: 400 });

    const { results: rows } = await env.DB.prepare(`SELECT user_id, alias, score, rules_part, rr, day FROM competition_entries WHERE competition_id = ? AND status = 'ok'`).bind(c.id).all();
    const pool = week ? rows.filter(e => e.day >= week.start && e.day <= week.end) : rows;
    const names = await userNames(env);
    const winners = leaderboard(pool, week ? crit.minTradesWeek : crit.minTrades).filter(r => r.qualified).slice(0, week ? crit.winnersWeek : crit.winnersFinal)
      .map(r => ({ rank: r.rank, userId: r.userId, alias: r.alias, name: names[r.userId]?.name || '', email: names[r.userId]?.email || '', avg: r.avg, entries: r.entries, rulesPct: r.rulesPct, netR: r.netR }));
    const res = { declaredAt: new Date().toISOString(), winners, participants: new Set(pool.map(r => r.user_id)).size, entries: pool.length, revealNames: !!b.revealNames, prize: week ? (c.prize_weekly || '') : (c.prize_final || '') };
    if (week) { weekRes[week.start] = res; await env.DB.prepare('UPDATE competitions SET week_results = ? WHERE id = ?').bind(JSON.stringify(weekRes), c.id).run(); }
    else await env.DB.prepare(`UPDATE competitions SET status = 'results', results = ?, reveal_names = ? WHERE id = ?`).bind(JSON.stringify(res), b.revealNames ? 1 : 0, c.id).run();
    return json({ results: publicWinners(res, user.id, true), week: week || null });
  } catch (e) { console.error('comp declare', e); return json({ error: 'Declare nahi hua.' }, { status: 500 }); }
}
