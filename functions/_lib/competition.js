// 🏆 Competition (Discipline Challenge)
// Sir shares one strategy. A trade that a trader logs with that strategy is copied
// (anonymously) into the competition every time the journal is saved. Everything
// here runs on the server, so nobody can send a fake score.

export const DEFAULT_CRITERIA = {
  weights: { rules: 35, sl: 10, slRespected: 15, noMistake: 15, emotion: 5, journal: 5, result: 15 },
  minTrades: 3,        // trades needed to be ranked overall
  minTradesWeek: 2,    // trades needed to be ranked in one week
  maxPerDay: 3,        // competition trades counted per day (stops overtrading)
  winnersWeek: 1, winnersFinal: 3
};
const BAD_EMOTIONS = ['fomo', 'revenge', 'tilt', 'overexcited', 'anxious', 'greedy', 'fear'];
const ADJ = ['Calm', 'Steady', 'Patient', 'Sharp', 'Silent', 'Focused', 'Brave', 'Wise', 'Swift', 'Bold', 'Clear', 'Cool', 'Iron', 'Golden', 'Zen', 'Stoic'];
const ANIMAL = [['Tiger', '🐯'], ['Falcon', '🦅'], ['Wolf', '🐺'], ['Panda', '🐼'], ['Fox', '🦊'], ['Owl', '🦉'], ['Lion', '🦁'], ['Bear', '🐻'], ['Shark', '🦈'], ['Hawk', '🪶'], ['Panther', '🐆'], ['Dolphin', '🐬'], ['Turtle', '🐢'], ['Bull', '🐂'], ['Horse', '🐎'], ['Elephant', '🐘']];

// Same trader + same competition => always the same name. A new competition gives a new name.
export async function aliasFor(userId, compId) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${compId}:${userId}`)));
  const [name, emoji] = ANIMAL[h[1] % ANIMAL.length];
  return `${emoji} ${ADJ[h[0] % ADJ.length]} ${name} ${100 + ((h[2] * 256 + h[3]) % 900)}`;
}

const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export function normCriteria(c) {
  const w = { ...DEFAULT_CRITERIA.weights, ...(c?.weights || {}) };
  Object.keys(w).forEach(k => { if (!(k in DEFAULT_CRITERIA.weights)) delete w[k]; else w[k] = Math.max(0, Math.min(100, Number(w[k]) || 0)); });
  return {
    weights: w,
    minTrades: clampInt(c?.minTrades, 1, 100, DEFAULT_CRITERIA.minTrades),
    minTradesWeek: clampInt(c?.minTradesWeek, 1, 50, DEFAULT_CRITERIA.minTradesWeek),
    maxPerDay: clampInt(c?.maxPerDay, 1, 20, DEFAULT_CRITERIA.maxPerDay),
    winnersWeek: clampInt(c?.winnersWeek, 1, 5, DEFAULT_CRITERIA.winnersWeek),
    winnersFinal: clampInt(c?.winnersFinal, 1, 5, DEFAULT_CRITERIA.winnersFinal)
  };
}
export const parseJson = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
const num = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/* ---------- dates (competition dates are Indian dates) ---------- */
export const istEnd = d => new Date(`${d}T23:59:59+05:30`);
export const istStart = d => new Date(`${d}T00:00:00+05:30`);
export const GRACE_MS = 24 * 3600 * 1000;   // a trade of the last day can still be journaled the next day
export function compState(c, now = new Date()) {
  if (c.status === 'results') return 'results';
  if (now < istStart(c.start_date)) return 'upcoming';
  if (now > istEnd(c.end_date)) return 'ended';
  return 'live';
}
export const acceptsEntries = (c, now = new Date()) => c.status === 'active' && now >= istStart(c.start_date) && now.getTime() <= istEnd(c.end_date).getTime() + GRACE_MS;
export function tradeIstDate(t) {
  const raw = String(t?.tradeDateTime || t?.date || '');
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(raw)) return raw.slice(0, 10);   // local (IST) value typed in the form
  const d = new Date(raw); if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}
const iso = d => d.toISOString().slice(0, 10);
// Monday–Sunday weeks, cut to the competition dates.
export function weeksOf(startDate, endDate) {
  const out = []; let d = new Date(`${startDate}T00:00:00Z`); const end = new Date(`${endDate}T00:00:00Z`);
  while (d <= end && out.length < 20) {
    const sun = new Date(d); sun.setUTCDate(sun.getUTCDate() + (6 - ((d.getUTCDay() + 6) % 7)));
    const e = sun > end ? end : sun;
    out.push({ n: out.length + 1, start: iso(d), end: iso(e) });
    d = new Date(e); d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
export const weekState = (w, now = new Date()) => (now < istStart(w.start) ? 'upcoming' : now > istEnd(w.end) ? 'ended' : 'live');

/* ---------- what is shared + how it is scored ---------- */
// Only these fields leave the private journal. No quantity and no ₹ P&L — the result is shown in R.
const PUBLIC_FIELDS = ['symbol', 'type', 'entryPrice', 'exitPrice', 'stopLoss', 'rr', 'mistake', 'followedPlan', 'exitReason', 'tradeDateTime', 'quality'];
export function buildSnapshot(t, day, hasImage) {
  const s = {}; PUBLIC_FIELDS.forEach(k => { if (t[k] !== undefined) s[k] = t[k]; });
  s.symbol = String(s.symbol || '').slice(0, 30); s.exitReason = String(s.exitReason || '').slice(0, 200);
  s.emotions = (Array.isArray(t.emotions) ? t.emotions : [t.emotion]).filter(Boolean).map(e => String(e).slice(0, 40)).slice(0, 6);
  s.notes = String(t.notes || '').trim().slice(0, 500);
  const en = num(t.entryPrice), ex = num(t.exitPrice);
  s.outcome = ex === null || en === null ? 'open' : (() => { const d = (t.type === 'SHORT' ? en - ex : ex - en); return d > 0 ? 'win' : d < 0 ? 'loss' : 'be'; })();
  s.day = day; s.hasImage = !!hasImage;
  return s;
}
export function scoreEntry(snap, rulesChecked, rulesCount, criteria) {
  const w = criteria.weights, total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const emos = (snap.emotions || []).map(e => String(e).toLowerCase());
  const hasSl = num(snap.stopLoss) > 0, open = snap.outcome === 'open', rr = hasSl ? num(snap.rr) : null;
  const clean = (!snap.mistake || snap.mistake === 'none');
  const parts = {
    rules: rulesCount ? Math.min(1, (rulesChecked?.length || 0) / rulesCount) : 1,
    sl: hasSl ? 1 : 0,
    slRespected: !hasSl ? 0 : open ? 0.5 : (rr === null ? 0.5 : (rr >= -1.1 ? 1 : 0)),
    noMistake: clean ? 1 : 0,
    emotion: emos.some(e => BAD_EMOTIONS.some(b => e.includes(b))) ? 0 : 1,
    journal: (snap.notes.length >= 10 ? 0.5 : 0) + (snap.hasImage ? 0.5 : 0),
    // a good trade earns more, but a small controlled loss still earns something — one lucky trade can't win it
    result: open ? 0.3 : !hasSl ? (snap.outcome === 'win' ? 0.5 : 0) : rr === null ? 0.3 : rr >= 2 ? 1 : rr >= 1 ? 0.8 : rr > 0 ? 0.6 : rr >= -1.1 ? 0.3 : 0
  };
  const score = Object.entries(parts).reduce((a, [k, v]) => a + v * (w[k] || 0), 0) / total * 100;
  return { score: Math.round((score + 1e-9) * 10) / 10, parts };   // +1e-9: 28.25 always rounds up, same as the preview in the app
}

// rows: [{ user_id, alias, score, rules_part, rr, day }]
export function leaderboard(rows, minTrades) {
  const by = new Map();
  for (const e of rows) {
    const g = by.get(e.user_id) || { userId: e.user_id, alias: e.alias, entries: 0, total: 0, rules: 0, allRules: 0, netR: 0, days: new Set() };
    g.entries++; g.total += Number(e.score) || 0; g.rules += Number(e.rules_part) || 0; if (Number(e.rules_part) >= 1) g.allRules++;
    if (Number.isFinite(Number(e.rr)) && e.rr !== null) g.netR += Number(e.rr);
    g.days.add(e.day); by.set(e.user_id, g);
  }
  const out = [...by.values()].map(g => ({ userId: g.userId, alias: g.alias, entries: g.entries, days: g.days.size, avg: Math.round(g.total / g.entries * 10) / 10,
    rulesPct: Math.round(g.rules / g.entries * 100), allRules: g.allRules, netR: Math.round(g.netR * 100) / 100, qualified: g.entries >= minTrades }));
  // discipline first; then more disciplined trades; then the better result
  out.sort((a, b) => (b.qualified - a.qualified) || (b.avg - a.avg) || (b.entries - a.entries) || (b.netR - a.netR) || (a.alias < b.alias ? -1 : 1));
  let rank = 0; out.forEach(r => { r.rank = r.qualified ? ++rank : null; });
  return out;
}

export function compToJson(r, extra = {}) {
  const weeks = weeksOf(r.start_date, r.end_date);
  return { id: r.id, title: r.title, strategy: r.strategy, description: r.description, rules: parseJson(r.rules, []), entryCriteria: r.entry_criteria, exitCriteria: r.exit_criteria,
    startDate: r.start_date, endDate: r.end_date, criteria: normCriteria(parseJson(r.criteria, {})), prizeWeekly: r.prize_weekly || '', prizeFinal: r.prize_final || '',
    status: r.status, state: compState(r), accepting: acceptsEntries(r), weekCount: weeks.length, revealNames: !!r.reveal_names, createdAt: r.created_at, ...extra };
}
// winners as stored -> what this viewer may see
export function publicWinners(res, viewerId, admin) {
  if (!res) return null;
  return { declaredAt: res.declaredAt, participants: res.participants, entries: res.entries, prize: res.prize || '', revealNames: !!res.revealNames,
    winners: (res.winners || []).map(w => ({ rank: w.rank, alias: w.alias, avg: w.avg, entries: w.entries, rulesPct: w.rulesPct, netR: w.netR, mine: w.userId === viewerId,
      ...(res.revealNames || admin ? { name: w.name } : {}), ...(admin ? { email: w.email } : {}) })) };
}

/* ---------- journal -> competition (runs after every journal save) ---------- */
const imgOwnedBy = (t, userId) => [t.beforeImage, ...(Array.isArray(t.images) ? t.images : []), t.image, t.afterImage]
  .map(x => (typeof x === 'string' ? x.split('?')[0] : '')).find(x => x.startsWith(`/api/img/${userId}/`)) || '';
async function copyImage(env, src) {
  if (!src || !env.IMAGES) return '';
  try {
    const obj = await env.IMAGES.get(src.replace('/api/img/', ''));
    if (!obj) return '';
    const ext = (src.match(/\.(jpg|jpeg|png|webp|gif)$/i) || ['', 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg');
    const name = `${crypto.randomUUID()}.${ext}`;
    await env.IMAGES.put(`comp/${name}`, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
    return `/api/comp-img/${name}`;
  } catch (e) { console.error('comp image copy', e); return ''; }
}
export async function dropImage(env, image) {
  if (!image || !env.IMAGES) return;
  try { await env.IMAGES.delete(`comp/${image.replace('/api/comp-img/', '')}`); } catch (e) { console.error('comp image delete', e); }
}

export async function syncUserEntries(env, user, trades, now = new Date()) {
  const out = { added: [], updated: [], removed: 0, skipped: [] };
  const { results: comps } = await env.DB.prepare(`SELECT * FROM competitions WHERE status = 'active'`).all();
  const open = (comps || []).filter(c => acceptsEntries(c, now));
  if (!open.length) return out;
  const list = Array.isArray(trades) ? trades.filter(t => t && typeof t === 'object') : [];
  for (const c of open) {
    const crit = normCriteria(parseJson(c.criteria, {})), rules = parseJson(c.rules, []);
    const frozenWeeks = Object.keys(parseJson(c.week_results, {}));          // a week with declared winners is locked
    const weeks = weeksOf(c.start_date, c.end_date);
    const frozen = day => weeks.some(w => frozenWeeks.includes(w.start) && day >= w.start && day <= w.end);
    const { results: mine } = await env.DB.prepare('SELECT id, trade_id, trade, rules_checked, image, image_src, day, status FROM competition_entries WHERE competition_id = ? AND user_id = ?').bind(c.id, user.id).all();
    const byTrade = new Map((mine || []).map(e => [String(e.trade_id), e]));
    const perDay = {}; (mine || []).forEach(e => { perDay[e.day] = (perDay[e.day] || 0) + 1; });
    const tagged = list.filter(t => String(t.competitionId || '') === c.id);
    const keep = new Set();
    let alias = null;
    for (const t of tagged) {
      const id = String(t.id || ''); if (!id || keep.has(id)) continue;
      keep.add(id);
      const day = tradeIstDate(t), ex = byTrade.get(id);
      if (!day || day < c.start_date || day > c.end_date) { if (!ex) out.skipped.push({ tradeId: id, reason: 'dates', competitionId: c.id }); else keep.delete(id); continue; }
      if (frozen(day) || (ex && frozen(ex.day))) { if (!ex) out.skipped.push({ tradeId: id, reason: 'locked', competitionId: c.id }); continue; }
      const checked = [...new Set((Array.isArray(t.compRules) ? t.compRules : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < rules.length))].sort((a, b) => a - b);
      const src = imgOwnedBy(t, user.id);
      if (!ex) {
        if ((perDay[day] || 0) >= crit.maxPerDay) { out.skipped.push({ tradeId: id, reason: 'limit', limit: crit.maxPerDay, competitionId: c.id }); continue; }
        const image = await copyImage(env, src);
        const snap = buildSnapshot(t, day, !!image), { score, parts } = scoreEntry(snap, checked, rules.length, crit);
        alias = alias || await aliasFor(user.id, c.id);
        const ts = now.toISOString();
        await env.DB.prepare(`INSERT INTO competition_entries (id, competition_id, user_id, alias, trade_id, trade, rules_checked, image, image_src, score, breakdown, day, rr, rules_part, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?) ON CONFLICT(competition_id, trade_id, user_id) DO NOTHING`)
          .bind(crypto.randomUUID(), c.id, user.id, alias, id, JSON.stringify(snap), JSON.stringify(checked), image, src, score, JSON.stringify(parts), day, snap.outcome === 'open' ? null : num(snap.rr), parts.rules, ts, ts).run();
        perDay[day] = (perDay[day] || 0) + 1;
        out.added.push({ tradeId: id, score, competitionId: c.id });
      } else {
        let image = ex.image;
        if (src !== (ex.image_src || '')) { await dropImage(env, ex.image); image = await copyImage(env, src); }
        const snap = buildSnapshot(t, day, !!image), snapJson = JSON.stringify(snap), rulesJson = JSON.stringify(checked);
        if (snapJson === ex.trade && rulesJson === ex.rules_checked && image === ex.image) continue;
        const { score, parts } = scoreEntry(snap, checked, rules.length, crit);
        await env.DB.prepare('UPDATE competition_entries SET trade = ?, rules_checked = ?, image = ?, image_src = ?, score = ?, breakdown = ?, day = ?, rr = ?, rules_part = ?, updated_at = ? WHERE id = ?')
          .bind(snapJson, rulesJson, image, src, score, JSON.stringify(parts), day, snap.outcome === 'open' ? null : num(snap.rr), parts.rules, now.toISOString(), ex.id).run();
        out.updated.push({ tradeId: id, score, competitionId: c.id });
      }
    }
    // trade deleted, or its strategy changed away from Sir's strategy -> take it out of the competition
    for (const e of (mine || [])) {
      if (keep.has(String(e.trade_id)) || frozen(e.day) || e.status === 'removed') continue;   // an entry removed by the admin stays removed
      await env.DB.prepare('DELETE FROM competition_claps WHERE entry_id = ?').bind(e.id).run();
      await env.DB.prepare('DELETE FROM competition_entries WHERE id = ?').bind(e.id).run();
      await dropImage(env, e.image);
      out.removed++;
    }
  }
  return out;
}

/* ---------- shared by the read endpoints ---------- */
export async function clapMap(env, compId, viewerId) {
  const { results } = await env.DB.prepare('SELECT entry_id, COUNT(*) AS n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS me FROM competition_claps WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = ?) GROUP BY entry_id').bind(viewerId, compId).all();
  return new Map((results || []).map(r => [r.entry_id, { n: r.n, me: !!r.me }]));
}
// One feed card. Traders never get a user id, name or email — only the alias.
export function feedRow(r, viewerId, admin, names, claps) {
  const mine = r.user_id === viewerId, c = claps?.get(r.id);
  return { id: r.id, alias: r.alias, mine, trade: parseJson(r.trade, {}), rulesChecked: parseJson(r.rules_checked, []), image: r.image, score: r.score, breakdown: parseJson(r.breakdown, {}),
    day: r.day, createdAt: r.created_at, claps: c?.n || 0, clapped: !!c?.me, status: r.status || 'ok',
    ...(mine ? { sourceId: r.trade_id } : {}), ...(mine || admin ? { adminNote: r.admin_note || '' } : {}), ...(admin ? { realName: names?.[r.user_id]?.name || '—' } : {}) };
}
export async function userNames(env) {
  const { results } = await env.DB.prepare('SELECT id, name, email FROM users').all();
  return Object.fromEntries((results || []).map(u => [u.id, { name: u.name || u.email.split('@')[0], email: u.email }]));
}
export const FEED_PAGE = 40;
