import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
import { compToJson, normCriteria, aliasFor, leaderboard, weeksOf, weekState, parseJson, publicWinners, clapMap, feedRow, userNames, scoreEntry, dropImage, FEED_PAGE } from '../../_lib/competition.js';
import { validate } from './index.js';

// GET    /api/competitions/<id> -> competition + anonymous feed + overall and weekly leaderboards (admins also get real names)
// PUT    /api/competitions/<id> (admin) -> edit (scores are recalculated if the rules or weights change)
// DELETE /api/competitions/<id> (admin) -> remove with all entries
export async function onRequestGet({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const c = await env.DB.prepare('SELECT * FROM competitions WHERE id = ?').bind(String(params.id)).first();
    if (!c) return json({ error: 'Competition nahi mila.' }, { status: 404 });
    const admin = isAdminUser(user, env), crit = normCriteria(parseJson(c.criteria, {}));
    const names = admin ? await userNames(env) : {};
    // light rows for ranking (all entries), full rows only for one page of the feed
    const { results: light } = await env.DB.prepare(`SELECT user_id, alias, score, rules_part, rr, day FROM competition_entries WHERE competition_id = ? AND status = 'ok'`).bind(c.id).all();
    const board = rows => rows.map(g => ({ rank: g.rank, alias: g.alias, entries: g.entries, days: g.days, avg: g.avg, rulesPct: g.rulesPct, allRules: g.allRules, netR: g.netR, qualified: g.qualified, mine: g.userId === user.id,
      ...(admin ? { realName: names[g.userId]?.name || '—', email: names[g.userId]?.email || '' } : {}) }));
    const weekRes = parseJson(c.week_results, {});
    const weeks = weeksOf(c.start_date, c.end_date).map(w => ({ ...w, state: weekState(w), leaderboard: board(leaderboard(light.filter(e => e.day >= w.start && e.day <= w.end), crit.minTradesWeek)), declared: publicWinners(weekRes[w.start], user.id, admin) }));
    const claps = await clapMap(env, c.id, user.id);
    const where = admin ? '' : `AND (status = 'ok' OR user_id = ?)`;
    const feedQ = env.DB.prepare(`SELECT * FROM competition_entries WHERE competition_id = ? ${where} ORDER BY created_at DESC, id LIMIT ${FEED_PAGE + 1}`);
    const { results: page } = await (admin ? feedQ.bind(c.id) : feedQ.bind(c.id, user.id)).all();
    const { results: own } = await env.DB.prepare('SELECT * FROM competition_entries WHERE competition_id = ? AND user_id = ? ORDER BY created_at DESC').bind(c.id, user.id).all();
    const comp = compToJson(c, { entries: light.length, participants: new Set(light.map(r => r.user_id)).size, myAlias: await aliasFor(user.id, c.id), results: publicWinners(parseJson(c.results, null), user.id, admin) });
    return json({ competition: comp, feed: page.slice(0, FEED_PAGE).map(r => feedRow(r, user.id, admin, names, claps)), feedMore: page.length > FEED_PAGE,
      mine: own.map(r => feedRow(r, user.id, admin, names, claps)), leaderboard: board(leaderboard(light, crit.minTrades)), weeks, isAdmin: admin });
  } catch (e) { console.error('comp get', e); return json({ error: 'Competition load nahi hua.' }, { status: 500 }); }
}

export async function onRequestPut({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const c = await env.DB.prepare('SELECT * FROM competitions WHERE id = ?').bind(String(params.id)).first();
    if (!c) return json({ error: 'Competition nahi mila.' }, { status: 404 });
    const v = validate(await readJson(request)); if (v.error) return json({ error: v.error }, { status: 400 });
    const rulesJson = JSON.stringify(v.rules), critJson = JSON.stringify(v.criteria);
    await env.DB.prepare(`UPDATE competitions SET title=?, strategy=?, description=?, rules=?, entry_criteria=?, exit_criteria=?, start_date=?, end_date=?, criteria=?, prize_weekly=?, prize_final=? WHERE id=?`)
      .bind(v.title, v.strategy, v.description, rulesJson, v.entryCriteria, v.exitCriteria, v.startDate, v.endDate, critJson, v.prizeWeekly, v.prizeFinal, c.id).run();
    let rescored = 0;
    if (rulesJson !== c.rules || JSON.stringify(normCriteria(parseJson(c.criteria, {})).weights) !== JSON.stringify(v.criteria.weights)) {
      const { results: rows } = await env.DB.prepare('SELECT id, trade, rules_checked FROM competition_entries WHERE competition_id = ?').bind(c.id).all();
      const stmts = rows.map(r => {
        const checked = parseJson(r.rules_checked, []).filter(i => i < v.rules.length), { score, parts } = scoreEntry(parseJson(r.trade, { notes: '' }), checked, v.rules.length, v.criteria);
        return env.DB.prepare('UPDATE competition_entries SET rules_checked = ?, score = ?, breakdown = ?, rules_part = ? WHERE id = ?').bind(JSON.stringify(checked), score, JSON.stringify(parts), parts.rules, r.id);
      });
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      rescored = stmts.length;
    }
    return json({ competition: compToJson(await env.DB.prepare('SELECT * FROM competitions WHERE id = ?').bind(c.id).first()), rescored });
  } catch (e) { console.error('comp put', e); return json({ error: 'Competition save nahi hua.' }, { status: 500 }); }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const id = String(params.id);
    const { results: imgs } = await env.DB.prepare(`SELECT image FROM competition_entries WHERE competition_id = ? AND image != ''`).bind(id).all();
    await env.DB.prepare('DELETE FROM competition_claps WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = ?)').bind(id).run();
    await env.DB.prepare('DELETE FROM competition_entries WHERE competition_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM competitions WHERE id = ?').bind(id).run();
    for (const r of imgs || []) await dropImage(env, r.image);
    return json({ ok: true });
  } catch (e) { console.error('comp delete', e); return json({ error: 'Delete nahi hua.' }, { status: 500 }); }
}
