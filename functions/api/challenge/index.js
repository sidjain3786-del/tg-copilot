import { getUserFromRequest, json, readJson, ensureSchema, parseColumn } from '../../_lib/auth.js';
import { STAGES, progress, rowToChallenge, parse } from '../../_lib/challenge.js';

// GET  /api/challenge -> my active challenge + past attempts
// POST /api/challenge { action: 'start' | 'review' | 'restart' | 'stop', ... }
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const { results } = await env.DB.prepare('SELECT * FROM trade_challenges WHERE user_id = ? ORDER BY started_at DESC LIMIT 20').bind(user.id).all();
    const all = results.map(rowToChallenge);
    return json({ active: all.find(c => c.status === 'active') || null, history: all.filter(c => c.status !== 'active') });
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
    const start = async (strategy, attempt) => {
      const s = clip(strategy, 80); if (s.length < 2) return json({ error: 'Strategy chuno.' }, { status: 400 });
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO trade_challenges (id, user_id, strategy, started_at, status, reviews, focus, attempt) VALUES (?, ?, ?, ?, 'active', '{}', 'null', ?)`).bind(id, user.id, s, now, attempt).run();
      return json({ active: rowToChallenge(await env.DB.prepare('SELECT * FROM trade_challenges WHERE id = ?').bind(id).first()) });
    };
    const attempts = async () => ((await env.DB.prepare('SELECT COUNT(*) AS n FROM trade_challenges WHERE user_id = ?').bind(user.id).first())?.n || 0) + 1;

    if (b.action === 'start') {
      if (row) return json({ error: 'Ek challenge pehle se chal raha hai. Strategy badalni hai to "Restart" karo.' }, { status: 400 });
      return start(b.strategy, await attempts());
    }
    if (!row) return json({ error: 'Koi challenge nahi chal raha.' }, { status: 400 });
    if (b.action === 'restart') {
      if (clip(b.reason, 300).length < 5) return json({ error: 'Restart ki wajah likho (kam se kam 5 akshar).' }, { status: 400 });
      await end('restarted', b.reason);
      return start(b.strategy || row.strategy, await attempts());
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
