// Journal statistics for the admin dashboard (computed from the stored JSON).
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
function tradeTime(t) {
  const raw = t.tradeDateTime || t.createdAt || t.date;
  const d = new Date(raw); return Number.isNaN(d.getTime()) ? null : d;
}
export function isOpen(t) { return t.exitPrice === null || t.exitPrice === undefined || t.exitPrice === ''; }
export function journalStats(trades, notes, now = Date.now()) {
  const closed = trades.filter(t => !isOpen(t));
  const wins = closed.filter(t => num(t.pnl) > 0);
  const pnl = closed.reduce((a, t) => a + num(t.pnl), 0);
  const followed = closed.filter(t => t.followedPlan).length;
  const times = trades.map(tradeTime).filter(Boolean).map(d => d.getTime());
  const day = 86400000;
  const last7 = trades.filter(t => { const d = tradeTime(t); return d && now - d.getTime() <= 7 * day; });
  const last7Closed = last7.filter(t => !isOpen(t));
  const mistakes = {};
  closed.forEach(t => { if (t.mistake && t.mistake !== 'none') { const m = mistakes[t.mistake] || (mistakes[t.mistake] = { id: t.mistake, count: 0, pnl: 0 }); m.count++; m.pnl += num(t.pnl); } });
  const topMistake = Object.values(mistakes).sort((a, b) => b.count - a.count || a.pnl - b.pnl)[0] || null;
  // previous 7 days for "improving?"
  const prev7Closed = closed.filter(t => { const d = tradeTime(t); return d && now - d.getTime() > 7 * day && now - d.getTime() <= 14 * day; });
  const rate = list => list.length ? Math.round(list.filter(t => t.followedPlan).length / list.length * 100) : null;
  return {
    trades: trades.length, closed: closed.length, open: trades.length - closed.length,
    notes: Array.isArray(notes) ? notes.length : 0,
    pnl: Math.round(pnl * 100) / 100,
    winRate: closed.length ? Math.round(wins.length / closed.length * 100) : 0,
    avgR: closed.length ? Math.round(closed.reduce((a, t) => a + num(t.rr), 0) / closed.length * 100) / 100 : 0,
    ruleRate: closed.length ? Math.round(followed / closed.length * 100) : 0,
    trades7: last7.length, pnl7: Math.round(last7Closed.reduce((a, t) => a + num(t.pnl), 0) * 100) / 100,
    ruleRate7: rate(last7Closed), ruleRatePrev7: rate(prev7Closed),
    firstTradeAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastTradeAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    topMistake, strategies: new Set(trades.map(t => t.strategy).filter(Boolean)).size,
    xp: trades.reduce((a, t) => a + num(t.xpEarned), 0)
  };
}
