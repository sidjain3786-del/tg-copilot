import { getUserFromRequest, json } from '../_lib/auth.js';

const LEGACY_DEFAULT_STRATEGY_NAMES = new Set([
  'Asian High/Low Liquidity Sweep (AMD)',
  'ICT Fair Value Gap (FVG) + Breaker',
  'Order Block (OB) Retest with Displacement'
]);

function cleanStrategies(value) {
  let parsed = [];
  try { parsed = Array.isArray(value) ? value : JSON.parse(value || '[]'); } catch { parsed = []; }
  return parsed.filter(s => {
    const name = typeof s === 'string' ? s : s?.name;
    return name && !LEGACY_DEFAULT_STRATEGY_NAMES.has(String(name).trim());
  });
}

export async function onRequestGet({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });

  const row = await env.DB.prepare(
    'SELECT trades, notes, custom_strategies FROM user_data WHERE user_id = ?'
  ).bind(user.id).first();

  const trades = row ? JSON.parse(row.trades) : [];
  const notes = row ? JSON.parse(row.notes) : [];
  const customStrategies = cleanStrategies(row?.custom_strategies);

  // Clean legacy demo/default strategies from D1 as well, while preserving
  // every user-created strategy.
  if (row && JSON.stringify(customStrategies) !== row.custom_strategies) {
    await env.DB.prepare('UPDATE user_data SET custom_strategies = ?, updated_at = ? WHERE user_id = ?')
      .bind(JSON.stringify(customStrategies), new Date().toISOString(), user.id).run();
  }

  return json({ trades, notes, customStrategies });
}

export async function onRequestPost({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });

  const { trades, notes, customStrategies } = await request.json();
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO user_data (user_id, trades, notes, custom_strategies, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      trades = excluded.trades,
      notes = excluded.notes,
      custom_strategies = excluded.custom_strategies,
      updated_at = excluded.updated_at
  `).bind(
    user.id,
    JSON.stringify(trades || []),
    JSON.stringify(notes || []),
    JSON.stringify(customStrategies || []),
    updatedAt
  ).run();

  return json({ ok: true });
}
