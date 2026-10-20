import { getUserFromRequest, json, readJson, ensureSchema, parseColumn } from '../../_lib/auth.js';
import { STAGES, progress, rowToChallenge, parse, cleanRisk, cleanCap, getChalConfig, pickStrategy } from '../../_lib/challenge.js';

// GET  /api/challenge -> my active challenge + past attempts
// POST /api/challenge { action: 'start' | 'review' | 'restart' | 'stop', ... }
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const { results } = await env.DB.prepare('SELECT * FROM trade_challenges WHERE user_id = ? ORDER BY started_at DESC LIMIT 20').bind(user.id).all();
    const all = results.map(rowToChallenge);
    return json({ active: all.find(c => c.status === 'active') || null, history: all.filter(c => c.status !== 'active'), config: await getChalConfig(env) });
  } catch (e) { console.error('challenge get', e); return json({ error: 'Challenge load nahi hua.' }, { status: 500 }); }
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const b = await readJson(request) || {};
    const row = await env.DB.prepare(`SELECT * FROM trade_challenges WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1`).bind(user.id).first();
    const now = new Date().toISOString();
    const end = (status, reason) => env.DB.prepare('UPDATE trade_challenges SET status = ?, ended_at = ?, end_reason = ? WHERE id = ?').bind(status, now, clip(reason, 300), row.id).run();
    const start = async (pick, attempt, risk, cap) => {
      if (pick.error) return json({ error: pick.error }, { status: 400 });
      const id = crypto.randomUUID(), extras = JSON.stringify({ v: 2, strategyId: pick.strategyId || null });   // v2: competition trades stay out of the challenge
      await env.DB.prepare(`INSERT INTO trade_challenges (id, user_id, strategy, started_at, status, reviews, focus, attempt, risk, max_per_day, feedback, extras) VALUES (?, ?, ?, ?, 'active', '{}', 'null', ?, ?, ?, '{}', ?)`).bind(id, user.id, pick.name, now, attempt, cleanRisk(risk), cleanCap(cap), extras).run();
      return json({ active: rowToChallenge(await env.DB.prepare('SELECT * FROM trade_challenges WHERE id = ?').bind(id).first()) });
    };
    const attempts = async () => ((await env.DB.prepare('SELECT COUNT(*) AS n FROM trade_challenges WHERE user_id = ?').bind(user.id).first())?.n || 0) + 1;

    if (b.action === 'start') {
      if (row) return json({ error: 'Ek challenge pehle se chal raha hai. Strategy badalni hai to "Restart" karo.' }, { status: 400 });
      return start(pickStrategy(await getChalConfig(env), b), await attempts(), b.risk, b.maxPerDay ?? 3);
    }
    if (!row) return json({ error: 'Koi challenge nahi chal raha.' }, { status: 400 });
    if (b.action === 'restart') {
      if (clip(b.reason, 300).length < 5) return json({ error: 'Restart ki wajah likho (kam se kam 5 akshar).' }, { status: 400 });
      const same = !b.strategyId && (!b.strategy || b.strategy === row.strategy), oldId = parse(row.extras, {}).strategyId || null;
      const pick = same ? { name: row.strategy, strategyId: oldId } : pickStrategy(await getChalConfig(env), b);
      if (pick.error) return json({ error: pick.error }, { status: 400 });
      await end('restarted', b.reason);
      return start(pick, await attempts(), b.risk ?? row.risk, b.maxPerDay ?? row.max_per_day);
    }
    const extras = parse(row.extras, {});
    const saveExtras = () => env.DB.prepare('UPDATE trade_challenges SET extras = ? WHERE id = ?').bind(JSON.stringify(extras), row.id).run();
    const fresh = async () => rowToChallenge(await env.DB.prepare('SELECT * FROM trade_challenges WHERE id = ?').bind(row.id).first());
    if (b.action === 'settings') {   // risk per trade + daily limit
      await env.DB.prepare('UPDATE trade_challenges SET risk = ?, max_per_day = ? WHERE id = ?').bind(cleanRisk(b.risk), cleanCap(b.maxPerDay), row.id).run();
      return json({ active: await fresh() });
    }
    if (b.action === 'checkin') {    // quick look every 10 trades (10, 20, 30, 40, 60 ...)
      const n = Number(b.n);
      if (!(n >= 10 && n <= 90 && n % 10 === 0 && n % 25 !== 0)) return json({ error: 'Galat check-in.' }, { status: 400 });
      const d = await env.DB.prepare('SELECT trades FROM user_data WHERE user_id = ?').bind(user.id).first();
      if (progress(rowToChallenge(row), parseColumn(d?.trades || '[]', [])).logged < n) return json({ error: `Check-in ${n} trades ke baad hoga.` }, { status: 400 });
      extras.checkins = extras.checkins || {};
      extras.checkins[n] = { at: now, mistake: clip(b.mistake, 40), rule: clip(b.rule, 200), note: clip(b.note, 300) };
      await saveExtras(); return json({ active: await fresh() });
    }
    if (b.action === 'missed') {     // "setup aaya par trade nahi liya" / "bina setup trade le liya"
      const kind = b.kind === 'impulse' ? 'impulse' : 'skipped';
      extras.missed = [...(Array.isArray(extras.missed) ? extras.missed : []), { at: now, kind, note: clip(b.note, 200) }].slice(-300);
      await saveExtras(); return json({ active: await fresh() });
    }
    if (b.action === 'stop') { await end('stopped', b.reason || ''); return json({ active: null }); }
    if (b.action === 'review') {
      const stage = Number(b.stage), ch = rowToChallenge(row);
      if (!STAGES.includes(stage)) return json({ error: 'Galat stage.' }, { status: 400 });
      if (ch.reviews[stage]) return json({ error: 'Yeh review pehle hi ho chuka hai.' }, { status: 400 });
      const prev = STAGES[STAGES.indexOf(stage) - 1];
      if (prev && !ch.reviews[prev]) return json({ error: `Pehle ${prev} trades wala review karo.` }, { status: 400 });
      const d = await env.DB.prepare('SELECT trades FROM user_data WHERE user_id = ?').bind(user.id).first();
      const p = progress(ch, parseColumn(d?.trades || '[]', []));
      if (p.logged < stage) return json({ error: `Review ${stage} trades ke baad hoga — abhi ${p.logged} trades hain.` }, { status: 400 });
      const answers = {}; Object.entries(b.answers || {}).slice(0, 6).forEach(([k, v]) => { answers[clip(k, 20)] = clip(v, 1000); });
      if (Object.values(answers).filter(v => v.length >= 5).length < 1) return json({ error: 'Review ke jawab likho.' }, { status: 400 });
      let focus = ch.focus;
      if (stage === 50) {
        const mistake = clip(b.focus?.mistake, 40), rule = clip(b.focus?.rule, 200);
        if (!mistake || rule.length < 5) return json({ error: 'Ek weakness chuno aur uske liye apna rule likho.' }, { status: 400 });
        focus = { mistake, rule, setAt: now };
      }
      const statsJson = b.stats && typeof b.stats === 'object' ? JSON.stringify(b.stats) : '{}', stats = statsJson.length <= 4000 ? JSON.parse(statsJson) : {};
      ch.reviews[stage] = { at: now, answers, stats };
      await env.DB.prepare('UPDATE trade_challenges SET reviews = ?, focus = ? WHERE id = ?').bind(JSON.stringify(ch.reviews), JSON.stringify(focus), row.id).run();
      if (stage === 100) await end('completed', '');
      return json({ active: stage === 100 ? null : rowToChallenge(await env.DB.prepare('SELECT * FROM trade_challenges WHERE id = ?').bind(row.id).first()), completed: stage === 100 });
    }
    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) { console.error('challenge post', e); return json({ error: 'Challenge save nahi hua.' }, { status: 500 }); }
}
