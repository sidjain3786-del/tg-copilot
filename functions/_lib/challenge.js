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
// trades logged after the start: on the challenge strategy (in order), over the daily limit, and everything else ("outside")
export function splitTrades(ch, trades) {
  const name = norm(ch.strategy), start = Date.parse(ch.started_at || ch.startedAt);
  const all = [], outside = [];
  for (const t of Array.isArray(trades) ? trades : []) {
    if (!t || typeof t !== 'object') continue;
    const logged = Date.parse(t.date || '');
    if (!(logged >= start)) continue;                                  // no back-filling old trades
    const sep = Number((ch.extras || {}).v) >= 2 && t.competitionId;   // v2: a competition trade never counts in the challenge
    (t.isSetupTrade !== false && !sep && norm(t.strategy) === name ? all : outside).push(t);
  }
  all.sort((a, b) => (tradeKey(a) < tradeKey(b) ? -1 : 1));
  const cap = Number(ch.max_per_day ?? ch.maxPerDay) || 0, inside = [], overCap = [], perDay = {};
  for (const t of all) {
    const day = tradeKey(t).slice(0, 10);
    if (cap && (perDay[day] || 0) >= cap) overCap.push(t);           // "jaldi mat karo": only N trades a day count
    else { perDay[day] = (perDay[day] || 0) + 1; inside.push(t); }
  }
  return { inside, outside, overCap };
}
// a stage review is needed before trades beyond it count
export function progress(ch, trades) {
  const { inside, outside, overCap } = splitTrades(ch, trades), reviews = ch.reviews || {};
  const gate = STAGES.find(s => !reviews[s]) ?? 100;
  const counted = Math.min(inside.length, gate, 100);
  return { counted, logged: inside.length, waiting: Math.max(0, Math.min(inside.length, 100) - counted), gate, reviewDue: STAGES.find(s => !reviews[s] && inside.length >= s) || null, outside: outside.length, overCap: overCap.length,
    lastLoggedAt: [...inside, ...overCap].map(t => t.date).sort().pop() || null };
}
export const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
export function rowToChallenge(r) {
  return r ? { id: r.id, strategy: r.strategy, startedAt: r.started_at, status: r.status, reviews: parse(r.reviews, {}), focus: parse(r.focus, null), endedAt: r.ended_at || null, endReason: r.end_reason || '', attempt: r.attempt || 1,
    risk: Number(r.risk) || 0, maxPerDay: Number(r.max_per_day) || 0, feedback: parse(r.feedback, {}), extras: parse(r.extras, {}) } : null;
}
export const cleanRisk = v => Math.max(0, Math.min(1e9, Math.round(Number(v) || 0)));
export const cleanCap = v => { const n = Math.round(Number(v) || 0); return n > 0 ? Math.min(20, n) : 0; };

// ---- Admin's own challenge strategies (separate from competition strategies) ----
import { getSetting, putSetting } from './reminders.js';
export const DEFAULT_CONFIG = { strategies: [], allowOwn: true };
const cl = (v, n) => String(v ?? '').trim().slice(0, n);
export function cleanConfig(c) {
  const seen = new Set(), strategies = [];
  for (const x of Array.isArray(c?.strategies) ? c.strategies.slice(0, 30) : []) {
    const name = cl(x?.name, 80); if (name.length < 2 || seen.has(norm(name))) continue; seen.add(norm(name));
    const rules = (Array.isArray(x.rules) ? x.rules : String(x.rules || '').split('\n')).map(r => cl(r, 200)).filter(Boolean).slice(0, 12);
    strategies.push({ id: cl(x.id, 40) || crypto.randomUUID(), name, description: cl(x.description, 1000), entryCriteria: cl(x.entryCriteria, 1000), exitCriteria: cl(x.exitCriteria, 1000), rules, active: x.active !== false, createdAt: cl(x.createdAt, 40) || new Date().toISOString() });
  }
  return { strategies, allowOwn: c?.allowOwn !== false };
}
export async function getChalConfig(env) { return cleanConfig(await getSetting(env, 'challenge_config', DEFAULT_CONFIG)); }
export async function saveChalConfig(env, c) { const v = cleanConfig(c); await putSetting(env, 'challenge_config', v); return v; }
// which strategy a new challenge runs on: { name, strategyId } or { error }
export function pickStrategy(cfg, b) {
  const act = cfg.strategies.filter(x => x.active);
  if (b?.strategyId) { const s = act.find(x => x.id === b.strategyId); return s ? { name: s.name, strategyId: s.id } : { error: 'Yeh challenge strategy ab available nahi hai.' }; }
  const name = cl(b?.strategy, 80); if (name.length < 2) return { error: 'Strategy chuno.' };
  const s = act.find(x => norm(x.name) === norm(name)); if (s) return { name: s.name, strategyId: s.id };
  if (!cfg.allowOwn) return { error: 'Admin ki di hui challenge strategy mein se chuno.' };
  return { name, strategyId: null };
}
