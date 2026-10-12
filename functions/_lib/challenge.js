// 💯 100 Trades Challenge: one strategy, 100 journaled trades, a review every 25.
// Counting runs on the server too, so a stage review can't be submitted before its trades exist.
export const STAGES = [25, 50, 75, 100];
export const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const pad = n => String(n).padStart(2, '0');
// a stable "when was this trade" key, in Indian time, same as the app
export function tradeKey(t) {
  const raw = String(t?.tradeDateTime || '');
  let local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) ? raw.slice(0, 16) : '';
  if (!local) { const d = new Date(raw || t?.date || 0); if (!Number.isNaN(d.getTime())) { const x = new Date(d.getTime() + 5.5 * 3600000); local = `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`; } }
  return `${local}|${t?.date || ''}|${t?.id || ''}`;
}
// trades logged after the start: on the challenge strategy (in order) and everything else ("outside")
export function splitTrades(ch, trades) {
  const name = norm(ch.strategy), start = Date.parse(ch.started_at || ch.startedAt);
  const inside = [], outside = [];
  for (const t of Array.isArray(trades) ? trades : []) {
    if (!t || typeof t !== 'object') continue;
    const logged = Date.parse(t.date || '');
    if (!(logged >= start)) continue;                                  // no back-filling old trades
    (t.isSetupTrade !== false && norm(t.strategy) === name ? inside : outside).push(t);
  }
  inside.sort((a, b) => (tradeKey(a) < tradeKey(b) ? -1 : 1));
  return { inside, outside };
}
// a stage review is needed before trades beyond it count
export function progress(ch, trades) {
  const { inside, outside } = splitTrades(ch, trades), reviews = ch.reviews || {};
  const gate = STAGES.find(s => !reviews[s]) ?? 100;
  const counted = Math.min(inside.length, gate, 100);
  return { counted, logged: inside.length, waiting: Math.max(0, Math.min(inside.length, 100) - counted), gate, reviewDue: STAGES.find(s => !reviews[s] && inside.length >= s) || null, outside: outside.length };
}
export const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
export function rowToChallenge(r) {
  return r ? { id: r.id, strategy: r.strategy, startedAt: r.started_at, status: r.status, reviews: parse(r.reviews, {}), focus: parse(r.focus, null), endedAt: r.ended_at || null, endReason: r.end_reason || '', attempt: r.attempt || 1 } : null;
}
